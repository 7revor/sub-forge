import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Cipher } from '../src/crypto.ts';
import { Store } from '../src/store.ts';
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuleRepoService } from '../src/rule-repos/service.ts';
import { applyReadme, buildEntries, BUILTIN_REPOS, rawUrl } from '../src/rule-repos/adapters.ts';
import type { UpstreamFetcher } from '../src/net/upstream.ts';
import { addUser, client, setupApp } from './helpers.ts';
import { createApp } from '../src/app.ts';

const sha = 'a'.repeat(40);
const treeSha = 'b'.repeat(40);
const readme = '#### 使用说明\n- China.list，请使用 behavior: "classical"。\n- China_Domain.list，请使用 behavior: "domain"。\n#### 配置建议\n- China.list、China_Domain.list 共同使用。\n#### 规则链接\n';
const envs: { service: RuleRepoService; store: ReturnType<typeof setupApp>['store'] }[] = [];
afterEach(async () => { for (const env of envs.splice(0)) { await env.service.stop(); env.store.close(); } });

function setup() {
  let commit = sha;
  let failRef = '';
  let paths = ['rule/Surge/China/China.list', 'rule/Surge/China/China_Domain.list', "rule/Surge/Assassin'sCreed/Odyssey/Odyssey.list", 'rule/Surge/OpenAI/OpenAI.yaml', 'rule/Surge/OpenAI/OpenAI.list', 'rule/Surge/OpenAI/README.md'];
  const fetcher = vi.fn<UpstreamFetcher>(async url => {
    if (failRef && url.includes(failRef)) throw new Error('模拟上游失败');
    if (url.includes('/commits/')) return { status: 200, body: JSON.stringify({ sha: commit, commit: { tree: { sha: treeSha } } }) };
    if (url.includes('/git/trees/')) return { status: 200, body: JSON.stringify({ sha: treeSha, truncated: false, tree: (url.includes('/zydou/') ? ['openai.yml', 'openai.mrs', 'openai.txt', 'openai@ads.txt', 'openai@ads .txt', 'openai@-cn.txt'] : paths).map(path => ({ path, sha, type: 'blob' })) }) };
    if (url.endsWith('README.md')) return { status: 200, body: readme };
    return { status: 200, body: (url.includes('_Domain') || url.includes('/surge-domain-set/')) ? '.example.com\n' : 'DOMAIN,chatgpt.com\n' };
  });
  const env = setupApp({ fetcher });
  const service = new RuleRepoService(env.store, fetcher, () => 1_700_000_000_000);
  const app = createApp({ ...env, ruleRepos: service });
  envs.push({ service, store: env.store });
  return { ...env, app, service, fetcher, change: () => { commit = 'c'.repeat(40); }, fail: (part: string) => { failRef = part; }, setPaths: (next: string[]) => { paths = next; } };
}

describe('规则仓库适配器', () => {
  it('按完整目录分组，忽略非规则；按 README 组合互补文件', () => {
    const entries = buildEntries(BUILTIN_REPOS[0]!, { master: ['rule/Surge/China/China.list', 'rule/Surge/China/China_Domain.list', 'rule/Surge/China/README.md', 'rule/Surge/Parent/Child/Child.list'] });
    expect(entries.map(e => e.path)).toEqual(['China', 'Parent/Child']);
    const china = entries[0]!;
    applyReadme(china, 'surge', readme);
    expect(china.variants.find(v => v.recommended)?.files.map(f => f.behavior)).toEqual(['classical', 'domain']);
  });
  it('所有适配器仅接受 list/txt，Clash YAML 与二进制不进入索引', () => {
    const black = buildEntries(BUILTIN_REPOS[0]!, { master: ['rule/Clash/OnlyYaml/OnlyYaml.yaml', 'rule/Clash/OnlyYml/OnlyYml.yml', 'rule/Surge/OpenAI/OpenAI.list', 'rule/Clash/Text/Text.txt', 'rule/Surge/Binary/Binary.mrs'] });
    expect(black.map(e => e.path)).toEqual(['OpenAI', 'Text']);
    const zy = buildEntries(BUILTIN_REPOS[1]!, { clash: ['only.yml'], mrs: ['only.mrs'], 'surge-rule-set': ['openai.txt', 'bad.yaml', 'bad.json', 'bad.srs'] });
    expect(zy.map(e => e.path)).toEqual(['openai']);
    expect(BUILTIN_REPOS[1]!.refs).toEqual(['surge-rule-set', 'surge-domain-set']);
  });
  it('保留尾空格的互补文件，过滤错误属性，正确编码特殊字符', () => {
    const entries = buildEntries(BUILTIN_REPOS[1]!, { 'surge-rule-set': ['openai@ads .txt', 'openai@ads.txt', 'openai@-cn.txt', 'README.md'] });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.variants[0]!.files).toHaveLength(2);
    expect(rawUrl(BUILTIN_REPOS[1]!, entries[0]!.variants[0]!.files[0]!)).toContain('openai%40ads%20.txt');
  });
});

describe('规则仓库索引', () => {
  it.each([9, 10])('v%s 持久化库升级后保留文档，重启可直接搜索缓存索引', async version => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-repo-index-'));
    const path = join(dir, 'test.db');
    const cipher = new Cipher(randomBytes(32));
    let store = new Store(path, { cipher });
    try {
      store.put('ruleset', { id: 'old', name: '原规则', sources: [] }, 'alice');
      if (version === 9) store.db.exec('DROP TABLE rule_repo_entries; DROP TABLE rule_repos');
      else store.db.exec('ALTER TABLE rule_repos DROP COLUMN definition');
      store.db.pragma(`user_version = ${version}`);
      store.close(); store = new Store(path, { cipher });
      const h = setup();
      const service = new RuleRepoService(store, h.fetcher);
      await service.refresh('blackmatrix7');
      await service.stop(); store.close(); store = new Store(path, { cipher });
      const restarted = new RuleRepoService(store, h.fetcher);
      expect(store.getWithOwner('ruleset', 'old')?.owner).toBe('alice');
      expect(restarted.search('openai', undefined, undefined, 0, 50).total).toBe(1);
      await restarted.stop();
    } finally {
      store.close();
      for (const file of readdirSync(dir)) unlinkSync(join(dir, file));
      rmdirSync(dir);
    }
  });
  it('启动清理旧索引且同 commit 重建；已保存的 YAML 来源与文本关联不改动', async () => {
    const h = setup(); await h.service.refresh('blackmatrix7');
    const legacy = { repo: 'blackmatrix7', path: 'Legacy', name: 'Legacy', variants: [{ id: 'yaml', client: 'mihomo', files: [{ path: 'rule/Clash/Legacy/Legacy.yaml', ref: 'master', format: 'yaml' }] }] };
    h.store.db.prepare('INSERT INTO rule_repo_entries (repo,key,search_name,data) VALUES (?,?,?,?)').run('blackmatrix7','Legacy','legacy',JSON.stringify(legacy));
    const entry = h.store.db.prepare('SELECT data FROM rule_repo_entries WHERE repo=? AND key=?').get('blackmatrix7','OpenAI') as { data: string };
    const mixed = JSON.parse(entry.data); mixed.variants.push(legacy.variants[0]);
    h.store.db.prepare('UPDATE rule_repo_entries SET data=? WHERE repo=? AND key=?').run(JSON.stringify(mixed),'blackmatrix7','OpenAI');
    const doc = { id: 'legacy-yaml', name: '已保存 YAML', sources: [{ id: 'yaml', kind: 'remote' as const, format: 'yaml' as const, url: 'https://example.com/rules.yaml', repository: { repo: 'blackmatrix7', entry: 'Legacy', ref: 'master', path: 'rule/Clash/Legacy/Legacy.yaml' } }] };
    h.store.put('ruleset', doc, 'alice'); h.fetcher.mockClear();
    const restart = new RuleRepoService(h.store, h.fetcher);
    expect(restart.search('Legacy',undefined,undefined,0,50).total).toBe(0);
    expect((await restart.resolvedEntry('blackmatrix7','OpenAI')).variants.every(v=>v.files.every(f=>/\.(list|txt)$/.test(f.path)))).toBe(true);
    expect(h.store.get('ruleset','legacy-yaml')).toEqual(doc);
    await restart.refresh('blackmatrix7');
    expect(h.fetcher.mock.calls.some(c=>c[0].includes('/git/trees/'))).toBe(true);
    expect(restart.search('Legacy',undefined,undefined,0,50).total).toBe(0);
    await restart.stop();
  });
  it('启动自动索引，每日检查，停止后不再运行定时任务', async () => {
    vi.useFakeTimers();
    const h = setup();
    const service = new RuleRepoService(h.store, h.fetcher, Date.now);
    try {
      service.start(); await service.refresh('blackmatrix7'); await service.refresh('zydou');
      const calls = h.fetcher.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.fetcher.mock.calls.length).toBe(calls);
      await vi.advanceTimersByTimeAsync(86_400_000);
      expect(h.fetcher.mock.calls.length).toBeGreaterThan(calls);
      await service.stop();
      const stoppedCalls = h.fetcher.mock.calls.length;
      await vi.advanceTimersByTimeAsync(86_400_000);
      expect(h.fetcher.mock.calls.length).toBe(stoppedCalls);
    } finally { await service.stop(); vi.useRealTimers(); }
  });
  it('保存索引、名称归一化、仓库/客户端筛选与分页', async () => {
    const h = setup();
    await h.service.refresh('blackmatrix7');
    await h.service.refresh('zydou');
    expect(h.service.list()[0]).toMatchObject({ entries: 3, indexing: false });
    expect(h.service.search('OPEN _- ai', undefined, undefined, 0, 50).total).toBe(3);
    expect(h.service.search('open ai', 'blackmatrix7', 'surge', 0, 50).items).toEqual([expect.objectContaining({ path: 'OpenAI' })]);
    expect(h.service.search('', undefined, undefined, 1, 1).items).toHaveLength(1);
    expect(h.service.search('%', undefined, undefined, 0, 50).total).toBe(0);
    const another = new RuleRepoService(h.store, h.fetcher);
    expect(another.search('openai', undefined, undefined, 0, 50).total).toBe(3);
    await another.stop();
  });
  it('相同 commit 不重拉树，并发更新只运行一次', async () => {
    const h = setup();
    const first = h.service.refresh('blackmatrix7');
    const second = h.service.refresh('blackmatrix7');
    expect(first).toBe(second);
    await first;
    h.fetcher.mockClear();
    await h.service.refresh('blackmatrix7');
    expect(h.fetcher.mock.calls.map(c => c[0])).toHaveLength(1);
    expect(h.fetcher.mock.calls[0]![0]).toContain('/commits/');
  });
  it('部分分支失败不覆盖旧索引，恢复后清除错误', async () => {
    const h = setup();
    await h.service.refresh('zydou');
    const before = h.service.search('', 'zydou', undefined, 0, 50);
    h.change(); h.fail('/commits/surge-rule-set');
    await h.service.refresh('zydou');
    expect(h.service.search('', 'zydou', undefined, 0, 50)).toEqual(before);
    expect(h.service.list().find(r => r.id === 'zydou')?.error).toContain('模拟上游失败');
    h.fail(''); await h.service.refresh('zydou');
    expect(h.service.list().find(r => r.id === 'zydou')?.error).toBeUndefined();
  });
  it('空树保留最后成功的索引，停用后禁止搜索与详情', async () => {
    const h = setup(); await h.service.refresh('blackmatrix7'); h.change(); h.setPaths([]);
    await h.service.refresh('blackmatrix7');
    expect(h.service.search('openai', undefined, undefined, 0, 50).total).toBe(1);
    expect(h.service.list()[0]!.error).toContain('没有可识别');
    h.service.setEnabled('blackmatrix7', false);
    expect(h.service.search('', undefined, undefined, 0, 50).total).toBe(0);
    expect(() => h.service.detail('blackmatrix7', 'OpenAI')).toThrow('已启用');
  });
  it('被截断的递归树改用分目录结果，忽略符号链接', async () => {
    const h = setup();
    h.fetcher.mockImplementation(async url => {
      if (url.includes('/commits/')) return { status: 200, body: JSON.stringify({ sha, commit: { tree: { sha: treeSha } } }) };
      const recursive = url.endsWith('?recursive=1');
      const root = url.includes(treeSha);
      return { status: 200, body: JSON.stringify({ sha: treeSha, truncated: root && recursive, tree: root ? [{ type: 'tree', path: 'rule', sha: 'sub' }] : [{ type: 'blob', path: 'Surge/OpenAI/OpenAI.list' }, { type: 'blob', mode: '120000', path: 'Surge/Link/Link.list' }] }) };
    });
    await h.service.refresh('blackmatrix7');
    expect(h.service.search('', undefined, undefined, 0, 50).items.map(e => e.path)).toEqual(['OpenAI']);
    expect(h.fetcher.mock.calls.some(c => c[0].endsWith(treeSha))).toBe(true);
  });
  it('详情预览只取文本；失败可重试，成功统计去重条数', async () => {
    const h = setup(); await h.service.refresh('blackmatrix7');
    h.fail('China.list');
    expect((await h.service.detail('blackmatrix7', 'China')).previewError).toContain('模拟上游失败');
    h.fail('');
    const detail = await h.service.detail('blackmatrix7', 'China');
    expect(detail.count).toBe(2);
    expect(detail.variants.find(v => v.recommended)?.files).toHaveLength(2);
    expect(detail.preview.join('\n')).toContain('来源：');
  });
});

describe('规则仓库接口', () => {
  it('文件列表只读索引并按分支与路径去重，不请求推荐组合或内容', async () => {
    const h = setup(); const c = client(h.app);
    expect((await c.get('/api/rule-repos/files?repo=zydou&path=openai')).status).toBe(401);
    await addUser(h.store, 'alice'); await c.login('alice'); await h.service.refresh('zydou');
    const row = h.store.db.prepare('SELECT data FROM rule_repo_entries WHERE repo=? AND key=?').get('zydou', 'openai') as { data: string };
    const entry = JSON.parse(row.data); entry.variants.push(entry.variants[0]);
    h.store.db.prepare('UPDATE rule_repo_entries SET data=? WHERE repo=? AND key=?').run(JSON.stringify(entry), 'zydou', 'openai');
    h.fetcher.mockClear();
    const result = await c.get('/api/rule-repos/files?repo=zydou&path=openai');
    expect(result.status).toBe(200);
    expect(result.json.item.files.map((f: { ref: string; path: string }) => [f.ref, f.path])).toEqual([
      ['surge-domain-set', 'openai.txt'], ['surge-rule-set', 'openai.txt'],
    ]);
    expect(result.json.item.variants).toBeUndefined();
    expect(h.fetcher).not.toHaveBeenCalled();
  });
  it('按文件新建只关联选中来源，不受 README 组合影响，加入已有规则集时去重', async () => {
    const h = setup(); await addUser(h.store, 'alice'); const c = client(h.app); await c.login('alice');
    await h.service.refresh('blackmatrix7'); h.fail('README'); h.fetcher.mockClear();
    const body = { repo: 'blackmatrix7', path: 'China', file: { ref: 'master', path: 'rule/Surge/China/China_Domain.list' } };
    const result = await c.post('/api/rule-repos/import', body);
    expect(result.status).toBe(201); expect(result.json.item.sources).toHaveLength(1);
    expect(result.json.item.sources[0]).toMatchObject({ format: 'domain-set', repository: { repo: body.repo, entry: body.path, ...body.file } });
    expect(h.fetcher.mock.calls.map(([url]) => url)).toEqual(['https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Surge/China/China_Domain.list']);
    const added = await c.post('/api/rule-repos/import', { ...body, ruleset: result.json.item.id });
    expect(added.status).toBe(200); expect(added.json.item.sources).toHaveLength(1);
  });
  it('同路径不同分支创建对应文件；伪造文件、混用参数、上游失败均不落库', async () => {
    const h = setup(); await addUser(h.store, 'alice'); const c = client(h.app); await c.login('alice'); await h.service.refresh('zydou');
    for (const ref of ['surge-rule-set', 'surge-domain-set']) {
      const result = await c.post('/api/rule-repos/import', { repo: 'zydou', path: 'openai', file: { ref, path: 'openai.txt' } });
      expect(result.status).toBe(201);
      expect(result.json.item.sources).toHaveLength(1);
      expect(result.json.item.sources[0].repository.ref).toBe(ref);
      expect(result.json.item.sources[0].format).toBe(ref === 'surge-rule-set' ? 'classical' : 'domain-set');
    }
    const before = h.store.list('ruleset').length;
    for (const file of [null, {}, { ref: 'clash', path: 'openai.yml' }, { ref: 'main', path: 'openai.txt' }, { ref: 'surge-rule-set', path: 'https://example.com/custom.list' }]) {
      expect((await c.post('/api/rule-repos/import', { repo: 'zydou', path: 'openai', file })).status).toBe(400);
    }
    const file = { ref: 'surge-rule-set', path: 'openai.txt' };
    expect((await c.post('/api/rule-repos/import', { repo: 'zydou', path: 'openai', file, variant: 'anything' })).status).toBe(400);
    h.fail('openai.txt');
    expect((await c.post('/api/rule-repos/import', { repo: 'zydou', path: 'openai', file })).status).toBe(502);
    expect(h.store.list('ruleset')).toHaveLength(before);
    h.service.setEnabled('zydou', false);
    expect((await c.get('/api/rule-repos/files?repo=zydou&path=openai')).status).toBe(404);
    expect((await c.post('/api/rule-repos/import', { repo: 'zydou', path: 'openai', file })).status).toBe(404);
  });
  it('读接口要求登录、管理接口要求管理员、校验参数', async () => {
    const h = setup(); const c = client(h.app);
    expect((await c.get('/api/rule-repos')).status).toBe(401);
    expect((await c.get('/api/rule-repos/search')).status).toBe(401);
    await addUser(h.store, 'alice'); await c.login('alice');
    expect((await c.post('/api/rule-repos/zydou/refresh')).status).toBe(403);
    expect((await c.patch('/api/rule-repos/zydou', { enabled: false })).status).toBe(403);
    expect((await c.get('/api/rule-repos/search?limit=200')).status).toBe(400);
    expect((await c.get('/api/rule-repos/search?client=bad')).status).toBe(400);
    expect((await c.get('/api/rule-repos/entry?repo=zydou&path=missing')).status).toBe(404);
  });
  it('关联解析不落库，保存后锁定地址和关联身份，停用或索引删除后仍可保存既有来源', async () => {
    const h = setup(); await addUser(h.store, 'alice'); const c = client(h.app); await c.login('alice');
    await h.service.refresh('blackmatrix7');
    const resolved = await c.post('/api/rule-repos/resolve', { repo: 'blackmatrix7', path: 'China' });
    expect(resolved.status).toBe(200);
    expect(resolved.json.sources).toHaveLength(2);
    expect(h.store.list('ruleset')).toHaveLength(0);
    const created = await c.post('/api/rulesets', { name: '关联测试', sources: resolved.json.sources });
    expect(created.status).toBe(201);
    const doc = created.json.item;
    expect(doc.sources[0].repository).toMatchObject({ repo: 'blackmatrix7', entry: 'China', ref: 'master' });
    for (const patch of [{ url: 'https://example.com/custom.txt' }, { repository: undefined }, { kind: 'local', content: 'example.com' }, { repository: { ...doc.sources[0].repository, path: 'fake' } }]) {
      const result = await c.put(`/api/rulesets/${doc.id}`, { ...doc, sources: [{ ...doc.sources[0], ...patch }] });
      expect(result.status).toBe(400);
    }
    expect((await c.post('/api/rulesets', { name: '伪造', sources: [{ ...doc.sources[0], url: 'https://example.com/fake' }] })).status).toBe(400);
    expect((await c.post('/api/rulesets/preview', { id: doc.id, ruleset: { ...doc, sources: [{ ...doc.sources[0], url: 'https://example.com/fake' }] }, client: 'mihomo' })).status).toBe(400);
    h.service.setEnabled('blackmatrix7', false);
    h.store.db.prepare('DELETE FROM rule_repo_entries WHERE repo = ?').run('blackmatrix7');
    expect((await c.put(`/api/rulesets/${doc.id}`, { ...doc, note: '可修改备注', sources: doc.sources.map((s: object) => ({ ...s, enabled: false })) })).status).toBe(200);
    expect((await c.post('/api/rulesets', { name: '不可新增停用关联', sources: doc.sources })).status).toBe(400);
    expect((await c.put(`/api/rulesets/${doc.id}`, { ...doc, sources: [{ id: 'custom', kind: 'remote', url: 'https://example.com/custom', format: 'auto' }] })).status).toBe(200);
  });
  it('旧导入按完整名称与 URL 识别关联，自定义同 URL 和已改地址不被误判', async () => {
    const h = setup(); const user = await addUser(h.store, 'alice');
    await h.service.refresh('zydou');
    const old = { id: 'old', kind: 'remote' as const, name: 'zydou · openai.txt', url: 'https://raw.githubusercontent.com/zydou/domain-list-community-converter/surge-domain-set/openai.txt', format: 'domain-set' as const };
    h.store.put('ruleset', { id: 'legacy', name: '旧导入', sources: [old, { ...old, id: 'manual', name: '自定义' }, { ...old, id: 'changed', url: 'https://example.com/file' }] }, user.id);
    const restart = new RuleRepoService(h.store, h.fetcher);
    const migrated = h.store.getWithOwner('ruleset', 'legacy')!;
    expect(migrated.owner).toBe(user.id);
    expect(migrated.doc.sources[0]!.repository).toEqual({ repo: 'zydou', entry: 'openai', ref: 'surge-domain-set', path: 'openai.txt' });
    expect(migrated.doc.sources.slice(1).every(s => !s.repository)).toBe(true);
    await restart.stop();
  });
  it('管理员异步更新、停用与重新启用', async () => {
    const h = setup(); await addUser(h.store, 'root', 'admin'); const c = client(h.app); await c.login('root');
    expect((await c.post('/api/rule-repos/blackmatrix7/refresh')).status).toBe(202);
    await h.service.refresh('blackmatrix7');
    expect((await c.get('/api/rule-repos/search?q=openai')).json.total).toBe(1);
    expect((await c.patch('/api/rule-repos/blackmatrix7', { enabled: false })).status).toBe(200);
    expect((await c.get('/api/rule-repos/search?q=openai')).json.total).toBe(0);
    expect((await c.patch('/api/rule-repos/blackmatrix7', { enabled: true })).status).toBe(200);
  });
  it('导入推荐组合、保留既有配置并去重，不能写入其他用户的规则集', async () => {
    const h = setup(); const alice = await addUser(h.store, 'alice'); const bob = await addUser(h.store, 'bob');
    const c = client(h.app); await c.login('alice'); await h.service.refresh('blackmatrix7');
    const imported = await c.post('/api/rule-repos/import', { repo: 'blackmatrix7', path: 'China' });
    expect(imported.status).toBe(201);
    expect(imported.json.item.sources).toHaveLength(2);
    const id = imported.json.item.id;
    h.store.put('ruleset', { ...imported.json.item, noResolve: true }, alice.id);
    const appended = await c.post('/api/rule-repos/import', { repo: 'blackmatrix7', path: 'China', ruleset: id });
    expect(appended.status).toBe(200);
    expect(appended.json.item.sources).toHaveLength(2);
    expect(appended.json.item.noResolve).toBe(true);
    h.store.put('ruleset', { id: 'private', name: '私有', sources: [] }, bob.id);
    expect((await c.post('/api/rule-repos/import', { repo: 'blackmatrix7', path: 'China', ruleset: 'private' })).status).toBe(404);
    expect(h.store.getWithOwner('ruleset', id)?.owner).toBe(alice.id);
    h.store.put('profile', { id: 'profile', name: '导入验收', nodeSets: [], chains: [], refPolicy: { default: 'wrap' }, overlay: { extraRules: [{ anchor: 'top', rule: { id: 'r', matcher: { kind: 'ruleset', id }, target: { kind: 'builtin', name: 'REJECT' } } }] } });
    const rendered = await h.renderer.render('profile', { client: 'mihomo' });
    expect(rendered.ok).toBe(true);
    if (rendered.ok) expect(Object.values(rendered.render.rulesets).join('\n')).toContain('chatgpt.com');
  });
  it('zydou 空格文件都作为来源导入，不接受任意地址或二进制变体', async () => {
    const h = setup(); await addUser(h.store, 'alice'); const c = client(h.app); await c.login('alice'); await h.service.refresh('zydou');
    const imported = await c.post('/api/rule-repos/import', { repo: 'zydou', path: 'openai@ads' });
    expect(imported.status).toBe(201);
    expect(imported.json.item.sources).toHaveLength(2);
    expect(imported.json.item.sources.some((s: { url: string }) => s.url.includes('%20.txt'))).toBe(true);
    expect((await c.post('/api/rule-repos/import', { repo: 'zydou', path: 'openai', variant: 'mihomo:mrs:openai' })).status).toBe(400);
    expect((await c.post('/api/rule-repos/import', { repo: 'zydou', path: 'https://localhost/private' })).status).toBe(404);
  });
});
