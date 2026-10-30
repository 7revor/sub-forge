import { ruleBodies } from './helpers.ts';
import { afterEach, describe, expect, it } from 'vitest';
import { remoteRuleMatcher, type Matcher } from '@sub-forge/core';
import { setupRuleReferences } from './rule-reference-fixture.ts';
import { client } from './helpers.ts';
import { repositoryMatcher } from '../src/ruleset-reference.ts';
import { parse } from 'yaml';

const envs: Awaited<ReturnType<typeof setupRuleReferences>>[] = [];
afterEach(async () => { for (const env of envs.splice(0)) await env.stop(); });
const setup = async () => { const h = await setupRuleReferences(); envs.push(h); return h; };
const template = (matcher: Matcher) => ({ name: '引用验收', groups: [], rules: [{ id: 'r', matcher, target: { kind: 'builtin', name: 'REJECT' } }], final: { kind: 'builtin', name: 'DIRECT' } });

describe('模板统一规则引用', () => {
  it('平级搜索同名候选，精确匹配优先，分页不重不漏，公共规则增强跨用户可见', async () => {
    const h = await setup();
    for (let i = 0; i < 35; i++) h.store.put('ruleset', { id: `more-${i}`, name: `Google ${i}`, sources: [] }, h.user.id);
    const first = await h.admin.get('/api/rule-options/search?q=google&limit=30');
    const second = await h.admin.get('/api/rule-options/search?q=google&limit=30&offset=30');
    expect(first.json.total).toBe(38);
    expect(first.json.items.slice(0, 2).map((x: { label: string }) => x.label).sort()).toEqual(['Google.list', '本地 · Google']);
    const all = [...first.json.items, ...second.json.items];
    expect(new Set(all.map(x => x.value)).size).toBe(38);
    expect(all.some(x => x.label.includes('私有'))).toBe(true);
    expect((await h.admin.post('/api/rule-options/resolve', { source: 'local', id: 'private-google' })).status).toBe(200);
    expect((await h.admin.post('/api/templates/new/publish', template({ kind: 'ruleset', id: 'private-google' }))).status).toBe(201);
    expect((await client(h.app).get('/api/rule-options/search')).status).toBe(401);
    expect((await h.admin.get('/api/rule-options/search?offset=-1')).status).toBe(400);
  });

  it('仓库搜索作用域不混入本地，未就绪索引和无结果分别返回', async () => {
    const h = await setup();
    expect((await h.admin.get('/api/rule-options/search?q=google&scope=repository')).json.items).toHaveLength(1);
    h.repos.setEnabled('zydou', true);
    const missing = await h.admin.get('/api/rule-options/search?q=不存在');
    expect(missing.json.items).toEqual([]);
    expect(missing.json.notices.join()).toContain('索引尚未就绪');
  });

  it('选择不落本地库，引用身份稳定；发布、渲染与资源输出闭环', async () => {
    const h = await setup();
    const matcher = await h.resolve();
    expect(await h.resolve()).toEqual(matcher);
    expect(h.store.list('ruleset')).toHaveLength(2);
    const draft = template(matcher);
    const published = await h.admin.post('/api/templates/new/publish', { ...draft, rules: draft.rules.map(r => ({ ...r, options: { src: true } })) });
    expect(published.status).toBe(201);
    h.store.put('profile', { id: 'p', name: '引用配置', nodeSets: [], overlay: {}, chains: [], refPolicy: { default: 'wrap' }, template: { id: published.json.item.id, follow: 'latest' } }, h.user.id);
    const rendered = await h.renderer.render('p', { client: 'mihomo' });
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const config = parse(rendered.render.yaml);
    expect(Object.keys(config['rule-providers'])).toEqual(['Google']);
    expect(config.rules).toContain('RULE-SET,Google,REJECT');
    expect(Object.values(ruleBodies(h.store, rendered.render)).join('\n')).toContain('google.example.test');
    expect(h.store.list('ruleset')).toHaveLength(2);
    expect((await h.admin.del('/api/rule-repos/blackmatrix7')).status).toBe(409);
  });

  it('停用或移除仓库资源后保留编辑定义，但发布、渲染与新选择均拒绝失效引用', async () => {
    const h = await setup(); const matcher = await h.resolve();
    const first = await h.admin.post('/api/templates/new/publish', template(matcher));
    h.repos.setEnabled('blackmatrix7', false);
    h.store.db.prepare('DELETE FROM rule_repo_entries WHERE repo = ?').run('blackmatrix7');
    expect((await h.admin.post('/api/templates/validate', { ...template(matcher), id: first.json.item.id })).json.report).toContainEqual(expect.objectContaining({ level: 'error', code: 'template.dangling-ruleset' }));
    expect((await h.admin.post(`/api/templates/${first.json.item.id}/publish`, template(matcher))).status).toBe(400);
    expect((await h.admin.post('/api/rule-options/resolve', { source: 'repository', repo: 'blackmatrix7', entry: 'Google' })).status).toBe(404);
    const preview = await h.renderer.previewDraft({ id: '', name: '草稿', nodeSets: [], overlay: {}, chains: [], refPolicy: { default: 'wrap' }, template: { id: first.json.item.id, follow: 'latest' } }, { client: 'mihomo' });
    expect(preview.ok).toBe(false);
  });

  it('伪造 URL、格式或身份均阻止发布，错误可定位到规则行', async () => {
    const h = await setup(); const matcher = await h.resolve();
    for (const change of ['url', 'format', 'identity', 'extra']) {
      const forged = structuredClone(matcher);
      if (change === 'url') forged.repository.sources[0].url = 'https://evil.example.test/rules';
      if (change === 'format') forged.repository.sources[0].format = 'classical';
      if (change === 'extra') forged.repository.sources[0].repository.unknown = '无效';
      const input = change === 'identity' ? { ...forged, id: 'local-google' } : repositoryMatcher(forged.repository);
      const res = await h.admin.post('/api/templates/new/publish', template(input));
      expect(res.status).toBe(400);
      expect(res.json.details.report).toContainEqual(expect.objectContaining({ where: 'rule:r', code: 'template.ruleset-reference' }));
    }
    expect(h.calls).toEqual([]);
  });

  it('上游不可解析时禁止发布并定位，禁用规则不触发上游请求', async () => {
    const h = await setup(); const matcher = await h.resolve(); h.setBody('<html>错误页面</html>');
    const invalid = await h.admin.post('/api/templates/new/publish', template(matcher));
    expect(invalid.status).toBe(400);
    expect(invalid.json.details.report).toContainEqual(expect.objectContaining({ where: 'rule:r', code: 'template.ruleset-unavailable' }));
    h.calls.length = 0;
    const disabled = template(matcher);
    const result = await h.admin.post('/api/templates/new/publish', { ...disabled, rules: disabled.rules.map(r => ({ ...r, enabled: false })) });
    expect(result.status).toBe(201);
    expect(h.calls).toEqual([]);
  });

  it('旧本地引用继续发布，内容定制留在本地规则集；私有规则也能引用仓库', async () => {
    const h = await setup();
    expect((await h.admin.post('/api/templates/new/publish', template({ kind: 'ruleset', id: 'local-google' }))).status).toBe(201);
    const matcher = await h.resolve();
    const profile = await h.admin.post('/api/profiles', { name: '私有引用', nodeSets: [], overlay: { extraRules: [{ anchor: 'top', rule: template(matcher).rules[0] }] } });
    expect(profile.status).toBe(201);
    const preview = await h.renderer.preview(profile.json.item.id, { client: 'mihomo' });
    expect(preview.ok).toBe(true);
  });
});


describe('关联模板的自定义规则引用', () => {
  it('前后规则支持远程、仓库和增强集合，保存、实际订阅及转换保持顺序', async () => {
    const h = await setup();
    const repository = await h.resolve();
    const published = await h.admin.post('/api/templates/new/publish', template({ kind: 'local', content: 'DOMAIN,template.example.test' }));
    expect(published.status).toBe(201);
    const entry = (id: string, matcher: Matcher) => ({ id, matcher, target: { kind: 'builtin', name: 'DIRECT' } });
    const routing = { mode: 'bound', templateId: published.json.item.id, groupAdditions: {},
      prependRules: [entry('remote', remoteRuleMatcher('https://rules.example.test/custom.list')), entry('repository', repository)],
      appendRules: [entry('enhanced', { kind: 'ruleset', id: 'local-google' })],
    };
    const saved = await h.admin.post('/api/profiles', { name: '完整自定义规则', nodeSets: [], overlay: {}, routing });
    expect(saved.status, saved.text).toBe(201);
    const id = saved.json.item.id;
    const read = await h.admin.get(`/api/profiles?id=${id}`);
    expect(read.json.item.routing).toEqual(routing);
    const token = h.store.userToken(h.user.id)!.token;
    const response = await h.app.request(`/subs/profile?token=${token}&id=${id}`);
    expect(response.status).toBe(200);
    const output = parse(await response.text());
    expect(output.rules).toEqual([expect.stringMatching(/^RULE-SET,/), expect.stringMatching(/^RULE-SET,/), 'DOMAIN,template.example.test,REJECT', expect.stringMatching(/^RULE-SET,/), 'MATCH,DIRECT']);
    const providers = Object.values(output['rule-providers']) as { url: string }[];
    expect(providers).toHaveLength(3);
    for (const provider of providers) {
      const nested = await h.app.request(provider.url);
      expect(nested.status).toBe(200);
      expect(await nested.text()).toMatch(/DOMAIN,(google|local)\.example\.test/);
    }
    const converted = await h.admin.post('/api/profiles/routing/convert', { profile: saved.json.item, mode: 'independent' });
    expect(converted.status).toBe(200);
    expect(converted.json.item.routing.config.rules.map((r: { id: string }) => r.id)).toEqual(['remote', 'repository', 'r', 'enhanced']);
    const reordered = { ...saved.json.item, routing: { ...routing, prependRules: routing.appendRules, appendRules: routing.prependRules } };
    expect((await h.admin.put(`/api/profiles/${id}`, reordered)).status).toBe(200);
    const preview = await h.admin.post('/api/profiles/preview', { profile: reordered });
    expect(preview.status).toBe(200);
    expect(preview.json.ok).toBe(true);
    expect(parse(preview.json.yaml).rules[1]).toBe('DOMAIN,template.example.test,REJECT');
    expect((await h.admin.del('/api/rule-repos/blackmatrix7')).status).toBe(409);
  });

  it('前后引用均校验来源身份，不允许伪造远程或仓库映射', async () => {
    const h = await setup();
    const repository = await h.resolve();
    const published = await h.admin.post('/api/templates/new/publish', { name: '空模板', groups: [], rules: [], final: { kind: 'builtin', name: 'DIRECT' } });
    const forged = structuredClone(repository);
    forged.repository.sources[0].url = 'https://forged.example.test/list';
    for (const key of ['prependRules', 'appendRules']) for (const matcher of [
      { kind: 'ruleset', id: 'missing' },
      { ...remoteRuleMatcher('https://rules.example.test/custom.list'), id: 'local-google' },
      repositoryMatcher(forged.repository),
    ]) {
      const profile = { name: '无效引用', nodeSets: [], overlay: {}, routing: { mode: 'bound', templateId: published.json.item.id, groupAdditions: {}, [key]: [{ id: 'custom', matcher, target: { kind: 'builtin', name: 'DIRECT' } }] } };
      expect((await h.admin.post('/api/profiles', profile)).status).toBe(400);
      expect((await h.admin.post('/api/profiles/preview', { profile })).status).toBe(400);
    }
    expect(h.calls).toEqual([]);
  });
});
