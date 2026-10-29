import { describe, expect, it } from 'vitest';
import type { UpstreamFetcher } from '../src/net/upstream.ts';
import { addUser, client, serve, setupApp } from './helpers.ts';

const activeLines = (lines: string[]) => lines.filter(line => line.trim() && !line.trimStart().startsWith('#'));
const AIRPORT = 'trojan://pw@a.example.com:443#香港 01 | 0.5x\ntrojan://pw@b.example.com:443#剩余流量：10G\ntrojan://pw@c.example.com:443#日本 03';
const UPSTREAM = serve({ 'https://a.example.com/sub': AIRPORT, 'https://b.example.com/sub': 'trojan://pw@d.example.com:443#香港 09' });
const remote = (name: string, url = 'https://a.example.com/sub') => ({ name, url: url });

async function scenario(fetcher?: UpstreamFetcher) {
  const env = setupApp(fetcher ? { fetcher } : {});
  await addUser(env.store, 'alice');
  await addUser(env.store, 'bob');
  const alice = client(env.app);
  const bob = client(env.app);
  await alice.login('alice');
  await bob.login('bob');
  return { ...env, alice, bob };
}

describe('处理链逐步预览', () => {
  it('花云格式的地区和流量说明节点在单独添加旗帜时正确预览', async () => {
    const body = [
      'Traffic: 13.24 GB | 150 GB', 'Expire: 2027-05-19',
      '摩尔多瓦标准 IEPL 专线 1', '印尼标准 IEPL 专线 1',
    ].map((name, i) => `trojan://pw@node${i}.example.com:443#${encodeURIComponent(name)}`).join('\n');
    const { alice } = await scenario(async () => ({ status: 200, body }));
    const id = (await alice.post('/api/sources', { ...remote('花云测试'), pipeline: [] })).json.item.id;
    const res = await alice.post(`/api/sources/${id}/pipeline-preview`, { pipeline: [{ op: 'flag', mode: 'add' }] });
    expect(res.status).toBe(200);
    expect(res.json.nodes.map((n: { name: string }) => n.name)).toEqual([
      'Traffic: 13.24 GB | 150 GB', 'Expire: 2027-05-19',
      '🇲🇩 摩尔多瓦标准 IEPL 专线 1', '🇮🇩 印尼标准 IEPL 专线 1',
    ]);
  });

  it('订阅源：按草稿处理链逐步执行，返回每步节点与差异', async () => {
    const { alice } = await scenario(UPSTREAM);
    const id = (await alice.post('/api/sources', { ...remote('A'), pipeline: [] })).json.item.id;
    const res = await alice.post(`/api/sources/${id}/pipeline-preview`, {
      pipeline: [{ op: 'filter.useless' }, { op: 'rename.regex', rules: [{ pattern: '^香港\\s*(\\d+).*$', replace: 'HK-$1' }] }, { op: 'flag', mode: 'add' }],
    });
    expect(res.status).toBe(200);
    expect(res.json.input).toBe(3);
    expect(res.json.trace.map((t: { op: string; before: number; after: number }) => [t.op, t.before, t.after])).toEqual([['filter.useless', 3, 2], ['rename.regex', 2, 2], ['flag', 2, 2]]);
    expect(res.json.trace[0].removed).toEqual(['剩余流量：10G']);
    expect(res.json.trace[1].renamed).toEqual([{ from: '香港 01 | 0.5x', to: 'HK-01' }]);
    expect(res.json.nodes.map((n: { name: string }) => n.name)).toEqual(['🇭🇰 HK-01', '🇯🇵 日本 03']);
    // 原始节点与每步的来源序号，供前端逐节点对照
    expect(res.json.inputNodes.map((n: { name: string }) => n.name)).toEqual(['香港 01 | 0.5x', '剩余流量：10G', '日本 03']);
    expect(res.json.trace.map((t: { origins: number[] }) => t.origins)).toEqual([[0, 2], [0, 2], [0, 2]]);
  });

  it('草稿里的非法正则直接报错；别人的订阅源不能预览', async () => {
    const { alice, bob } = await scenario(UPSTREAM);
    const id = (await alice.post('/api/sources', { ...remote('A'), pipeline: [] })).json.item.id;
    expect((await alice.post(`/api/sources/${id}/pipeline-preview`, { pipeline: [{ op: 'filter.regex', patterns: ['(['], keep: true }] })).status).toBe(400);
    expect((await bob.post(`/api/sources/${id}/pipeline-preview`, {})).status).toBe(404);
  });

  it('组合：成员先跑各自处理链与前缀，再逐步执行组合自身的处理链', async () => {
    const { alice } = await scenario(UPSTREAM);
    const a = (await alice.post('/api/sources', { ...remote('A'), pipeline: [{ op: 'filter.useless' }] })).json.item.id;
    const b = (await alice.post('/api/sources', { ...remote('B', 'https://b.example.com/sub'), pipeline: [] })).json.item.id;
    const col = (await alice.post('/api/collections', { name: 'C', members: [{ ref: { type: 'source', id: a }, prefix: 'A·' }, { ref: { type: 'source', id: b }, prefix: 'B·' }], pipeline: [] })).json.item.id;
    const res = await alice.post(`/api/collections/${col}/pipeline-preview`, { pipeline: [{ op: 'sort.name', order: 'desc' }] });
    expect(res.json.input).toBe(3);
    expect(res.json.nodes.map((n: { name: string }) => n.name)).toEqual(['B·香港 09', 'A·香港 01 | 0.5x', 'A·日本 03']);
  });

  it('组合：可带未保存的成员草稿，成员引用与成环仍按保存规则校验', async () => {
    const { alice } = await scenario(UPSTREAM);
    const a = (await alice.post('/api/sources', { ...remote('A'), pipeline: [] })).json.item.id;
    const col = (await alice.post('/api/collections', { name: 'C', members: [], pipeline: [] })).json.item.id;
    expect((await alice.post(`/api/collections/${col}/pipeline-preview`, {})).json.input).toBe(0);
    const res = await alice.post(`/api/collections/${col}/pipeline-preview`, { pipeline: [], members: [{ ref: { type: 'source', id: a }, suffix: '·A' }] });
    expect(res.json.input).toBe(3);
    expect(res.json.nodes.map((n: { name: string }) => n.name)).toContain('日本 03·A');
    expect((await alice.post(`/api/collections/${col}/pipeline-preview`, { members: [{ ref: { type: 'collection', id: col } }] })).status).toBe(400);
    expect((await alice.post(`/api/collections/${col}/pipeline-preview`, { members: [{ ref: { type: 'source', id: 'nope' } }] })).status).toBe(400);
  });
});

describe('立即拉取与快照', () => {
  it('远程订阅源：立即拉取、快照历史、失败时带原因', async () => {
    let fail = false;
    const { alice } = await scenario(async (url) => {
      if (fail) throw new Error('HTTP 502');
      return { status: 200, body: AIRPORT, userinfo: { total: 100 } };
    });
    const id = (await alice.post('/api/sources', { name: 'R', url: 'https://air.example.com/sub' })).json.item.id;
    const ok = await alice.post(`/api/sources/${id}/refresh`);
    expect(ok.json.items[0]).toMatchObject({ url: 'https://air.example.com/sub', ok: true, userinfo: { total: 100 } });
    fail = true;
    const bad = await alice.post(`/api/sources/${id}/refresh`);
    expect(bad.json.items[0]).toMatchObject({ ok: false, error: 'HTTP 502' });
    const hist = await alice.get(`/api/sources/${id}/snapshots`);
    expect(hist.json.items.map((s: { ok: boolean }) => s.ok).sort()).toEqual([false, true]);
    expect(hist.json.items[0]).not.toHaveProperty('body');
    // 处理链预览用最近一次成功的快照
    expect((await alice.post(`/api/sources/${id}/pipeline-preview`, {})).json.input).toBe(3);
  });
});

describe('规则集预览（CR-05）', () => {
  const RULES = 'DOMAIN-SUFFIX,notion.so\nPROCESS-NAME-REGEX,^steam.*\nPROCESS-PATH-WILDCARD,/Applications/*/Slack.app/*\nIP-CIDR,1.1.1.0/24,no-resolve\nUSER-AGENT,x*';
  const local = (id: string, content: string) => ({ id, kind: 'local', format: 'auto', content });

  it('单个来源按客户端与平台输出，列出降级、丢弃与无法解析的行；草稿不必保存', async () => {
    const { alice } = await scenario();
    const ruleset = { name: '', sources: [local('a', RULES)] };
    const mihomo = await alice.post('/api/rulesets/preview', { ruleset, source: 'a', client: 'mihomo' });
    expect(activeLines(mihomo.json.lines)).toEqual(['DOMAIN-SUFFIX,notion.so', 'PROCESS-NAME-REGEX,^steam.*', 'PROCESS-PATH-WILDCARD,/Applications/*/Slack.app/*', 'IP-CIDR,1.1.1.0/24,no-resolve']);
    expect(mihomo.json.rejected.map((r: { reason: string }) => r.reason)).toEqual(['不支持的规则类型 USER-AGENT']);
    expect(mihomo.json.sources).toEqual([{ id: 'a', ok: true, stale: false, format: 'classical', behavior: 'classical', rules: 4, rejected: 1, rejectedDetails: [{ line: 5, text: 'USER-AGENT,x*', reason: '不支持的规则类型 USER-AGENT' }] }]);
    const mac = await alice.post('/api/rulesets/preview', { ruleset, source: 'a', client: 'surge', platform: 'macos' });
    expect(mac.json.lines).toContain('PROCESS-NAME,steam*');
    expect(mac.json.notes).toHaveLength(1);
    const ios = await alice.post('/api/rulesets/preview', { ruleset, source: 'a', client: 'surge', platform: 'ios' });
    expect(activeLines(ios.json.lines)).toEqual(['DOMAIN-SUFFIX,notion.so', 'IP-CIDR,1.1.1.0/24,no-resolve']);
    expect(ios.json.dropped).toHaveLength(2);
  });

  it('切换来源只返回对应内容，合并时也提供各来源不支持行的详情', async () => {
    const { alice } = await scenario();
    const ruleset = { name: '多来源', sources: [
      local('a', '# 注释\nDOMAIN,a.test\nUSER-AGENT,a*'),
      local('b', 'DOMAIN,b.test\nUSER-AGENT,b*'),
      { ...local('off', 'DOMAIN,off.test'), enabled: false },
    ] };
    for (const source of ['a', 'b', 'off']) {
      const res = await alice.post('/api/rulesets/preview', { ruleset, source, client: 'mihomo' });
      expect(res.status).toBe(200);
      expect(activeLines(res.json.lines)).toEqual([`DOMAIN,${source}.test`]);
      expect(res.json.stats).toBeUndefined();
      expect(res.json.rejected).toHaveLength(source === 'off' ? 0 : 1);
    }
    const merged = await alice.post('/api/rulesets/preview', { ruleset, client: 'mihomo' });
    expect(activeLines(merged.json.lines)).toEqual(['DOMAIN,a.test', 'DOMAIN,b.test']);
    expect(merged.json.sources[0].rejectedDetails).toEqual([{ line: 3, text: 'USER-AGENT,a*', reason: '不支持的规则类型 USER-AGENT' }]);
    expect(merged.json.sources[1].rejectedDetails).toEqual([{ line: 2, text: 'USER-AGENT,b*', reason: '不支持的规则类型 USER-AGENT' }]);
  });

  it('来源诊断保留完整计数，详情最多返回 100 行', async () => {
    const { alice } = await scenario();
    const ruleset = { name: '大量不支持行', sources: [local('a', Array.from({ length: 105 }, (_, i) => `USER-AGENT,x${i}`).join('\n'))] };
    const res = await alice.post('/api/rulesets/preview', { ruleset, client: 'mihomo' });
    expect(res.status).toBe(200);
    expect(res.json.sources[0].rejected).toBe(105);
    expect(res.json.sources[0].rejectedDetails).toHaveLength(100);
    expect(res.json.sources[0].rejectedDetails[99].line).toBe(100);
  });

  it('不指定来源时返回合并结果：注释重复项、保留原顺序、跳过停用来源、统一 no-resolve', async () => {
    const { alice } = await scenario();
    const ruleset = { name: 'M', noResolve: true, sources: [
      local('a', 'IP-CIDR,10.0.0.0/8\nDOMAIN-KEYWORD,x\nDOMAIN,a.test'),
      local('b', 'DOMAIN,a.test\nDOMAIN-SUFFIX,b.test'),
      { ...local('off', 'DOMAIN,off.test'), enabled: false },
    ] };
    const res = await alice.post('/api/rulesets/preview', { ruleset, client: 'mihomo' });
    expect(activeLines(res.json.lines)).toEqual(['IP-CIDR,10.0.0.0/8,no-resolve', 'DOMAIN-KEYWORD,x', 'DOMAIN,a.test', 'DOMAIN-SUFFIX,b.test']);
    expect(res.json.stats).toEqual({ domain: 2, classical: 1, ipcidr: 1, total: 5, duplicates: 1 });
  });

  it('远程来源：已保存的规则集写入快照，新建草稿只拉取不落快照；拉取失败不阻断合并结果', async () => {
    const fetched: string[] = [];
    const { alice, store } = await scenario(async (url) => {
      fetched.push(url);
      if (url.endsWith('/bad')) throw new Error('上游 500');
      return { status: 200, body: 'DOMAIN,remote.test' };
    });
    const sources = [{ id: 'r', kind: 'remote', format: 'classical', url: 'https://rules.example.test/ok' }, { id: 'x', kind: 'remote', format: 'classical', url: 'https://rules.example.test/bad' }, local('l', 'DOMAIN,local.test')];
    const draft = await alice.post('/api/rulesets/preview', { ruleset: { name: 'N', sources }, client: 'mihomo' });
    expect(activeLines(draft.json.lines)).toEqual(['DOMAIN,remote.test', 'DOMAIN,local.test']);
    expect(draft.json.sources).toEqual([
      { id: 'r', ok: true, stale: false, format: 'classical', behavior: 'classical', rules: 1, rejected: 0 },
      { id: 'x', ok: false, stale: false, error: '上游 500' },
      { id: 'l', ok: true, stale: false, format: 'classical', behavior: 'classical', rules: 1, rejected: 0 },
    ]);
    expect(store.snapshotHistory('ruleset', 'draft')).toEqual([]);
    // 同一地址短时间内复用，不重复拉取
    await alice.post('/api/rulesets/preview', { ruleset: { name: 'N', sources }, source: 'r', client: 'mihomo' });
    expect(fetched.filter((u) => u.endsWith('/ok'))).toHaveLength(1);

    const id = (await alice.post('/api/rulesets', { name: 'N', sources: sources.slice(0, 1) })).json.item.id;
    // 已保存规则集里新填、尚未保存的地址同样不落快照
    await alice.post('/api/rulesets/preview', { id, ruleset: { name: 'N', sources }, client: 'mihomo' });
    expect(store.snapshotHistory('ruleset', id)).toHaveLength(1);
    const saved = await alice.post('/api/rulesets/preview', { id, ruleset: { name: 'N', sources: sources.slice(0, 1) }, source: 'r', client: 'mihomo' });
    expect(activeLines(saved.json.lines)).toEqual(['DOMAIN,remote.test']);
  });

  it('别人的规则集不能借 id 读快照', async () => {
    const { alice, bob } = await scenario();
    const id = (await alice.post('/api/rulesets', { name: 'A', sources: [local('a', 'DOMAIN,a.test')] })).json.item.id;
    expect((await bob.post('/api/rulesets/preview', { id, ruleset: { name: 'A', sources: [] }, client: 'mihomo' })).status).toBe(404);
  });
});

describe('节点集最终节点列表', () => {
  it('本地组自动去重，只返回节点摘要', async () => {
    const { alice } = await scenario();
    const proxies = ['a', 'b'].map((host) => ({ name: 'HK', type: 'trojan', server: `${host}.example.com`, port: 443, password: 'secret' }));
    const id = (await alice.post('/api/locals', { name: '本地组', proxies })).json.item.id;
    const res = await alice.get(`/api/nodesets/local/${id}/nodes`);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      nodes: proxies.map(({ password, ...p }, i) => ({ ...p, name: i ? 'HK 2' : 'HK' })),
      total: 2, truncated: false, report: [],
    });
  });

  it('订阅源使用保存的改名与过滤，组合继续执行成员前缀和自身处理链', async () => {
    const { alice } = await scenario(UPSTREAM);
    const source = (await alice.post('/api/sources', {
      ...remote('源'),
      pipeline: [{ op: 'rename.regex', rules: [{ pattern: '^香港.*$', replace: 'HK' }] }, { op: 'filter.regex', patterns: ['^HK$'], keep: true }],
    })).json.item.id;
    const local = (await alice.post('/api/locals', { name: '本地组', proxies: [{ name: 'HK', type: 'trojan', server: 'd.example.com', port: 443, password: 'pw' }] })).json.item.id;
    const collection = (await alice.post('/api/collections', {
      name: '组合', members: [{ ref: { type: 'source', id: source }, prefix: '成员-' }, { ref: { type: 'local', id: local }, prefix: '成员-' }],
      pipeline: [{ op: 'rename.affix', suffix: '-最终' }],
    })).json.item.id;
    const src = await alice.get(`/api/nodesets/source/${source}/nodes`);
    expect(src.status).toBe(200);
    expect(src.json.nodes.map((n: { name: string }) => n.name)).toEqual(['HK']);
    const col = await alice.get(`/api/nodesets/collection/${collection}/nodes`);
    expect(col.status).toBe(200);
    expect(col.json.nodes.map((n: { name: string }) => n.name)).toEqual(['成员-HK-最终', '成员-HK-最终 2']);
    expect(col.json).toMatchObject({ total: 2, truncated: false, report: [] });
  });

  it.each(['source', 'collection', 'local'] as const)('%s：未登录 401，别人的或不存在的节点集 404', async (type) => {
    const { alice, bob, app } = await scenario();
    const path = { source: 'sources', collection: 'collections', local: 'locals' }[type];
    const body = { source: remote('源'), collection: { name: '组合', members: [] }, local: { name: '本地组', proxies: [] } }[type];
    const id = (await alice.post(`/api/${path}`, body)).json.item.id;
    expect((await client(app).get(`/api/nodesets/${type}/${id}/nodes`)).status).toBe(401);
    expect((await bob.get(`/api/nodesets/${type}/${id}/nodes`)).status).toBe(404);
    expect((await alice.get(`/api/nodesets/${type}/missing/nodes`)).status).toBe(404);
  });

  it('不接受其他文档类型', async () => {
    const { alice } = await scenario();
    expect((await alice.get('/api/nodesets/preset/missing/nodes')).status).toBe(400);
  });

  it.each([5000, 5001])('%i 个节点：截断只影响返回列表，不影响总数', async (total) => {
    const { alice } = await scenario();
    const proxies = Array.from({ length: total }, (_, i) => ({ name: `节点-${i}`, type: 'trojan', server: 'a.example.com', port: 443, password: 'pw' }));
    const id = (await alice.post('/api/locals', { name: '大节点组', proxies })).json.item.id;
    const res = await alice.get(`/api/nodesets/local/${id}/nodes`);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ total, truncated: total > 5000, report: [] });
    expect(res.json.nodes).toHaveLength(5000);
    expect(res.json.nodes[4999].name).toBe('节点-4999');
  });

  it('单地址返回快照加载与解析报告，读取有效快照不重复拉取', async () => {
    let calls = 0;
    let fail = false;
    const { alice, advance, snapshots } = await scenario(async () => {
      calls++;
      if (fail) throw new Error('上游不可用');
      return { status: 200, body: AIRPORT + '\ntrojan://broken' };
    });
    const id = (await alice.post('/api/sources', { name: '远程源', url: 'https://example.com/sub', fetch: { ttlSec: 300 } })).json.item.id;
    const res = await alice.get(`/api/nodesets/source/${id}/nodes`);
    expect(res.status).toBe(200);
    expect(res.json.total).toBe(3);
    expect(res.json.report.map((r: { code: string }) => r.code)).toEqual(['source.parse-failure']);
    expect(calls).toBe(1);
    await alice.get(`/api/nodesets/source/${id}/nodes`);
    expect(calls).toBe(1);
    fail = true;
    advance(1000);
    await alice.post(`/api/sources/${id}/refresh`);
    const again = await alice.get(`/api/nodesets/source/${id}/nodes`);
    expect(again.json.report.map((r: { code: string }) => r.code)).toEqual(['source.fetch-failed', 'source.parse-failure']);
    expect(again.json.total).toBe(3);
    expect(calls).toBe(2);
    advance(301_000);
    await alice.get(`/api/nodesets/source/${id}/nodes`);
    await snapshots.settled();
    expect(calls).toBe(3);
  });
});

describe('规则集组级改写保存与预览', () => {
  it('保存、重新读取、各来源预览、合并预览和实际渲染都应用同一组级改写', async () => {
    const { alice, renderer } = await scenario(serve({ 'https://example.test/rules': 'DOMAIN,same.test\nDOMAIN,remote.test' }));
    const overrides = [{ match: 'DOMAIN,same.test', override: { when: { client: 'mihomo' }, action: { replace: [{ type: 'DOMAIN', value: 'changed.test' }] } } }];
    const created = await alice.post('/api/rulesets', { name: '整组', sources: [
      { id: 'a', kind: 'local', format: 'auto', content: 'DOMAIN,same.test' },
      { id: 'b', kind: 'remote', format: 'auto', url: 'https://example.test/rules' },
    ], overrides });
    expect(created.status).toBe(201);
    const rs = (await alice.get(`/api/rulesets/${created.json.item.id}`)).json.item;
    expect(rs.overrides).toEqual(overrides);
    expect(rs.sources.every((s: object) => !('overrides' in s))).toBe(true);
    for (const source of ['a', 'b', undefined]) {
      const preview = await alice.post('/api/rulesets/preview', { id: rs.id, ruleset: rs, source, client: 'mihomo' });
      expect(preview.status).toBe(200);
      expect(preview.json.lines).toContain('DOMAIN,changed.test');
      expect(preview.json.lines).not.toContain('DOMAIN,same.test');
    }
    const surge = await alice.post('/api/rulesets/preview', { ruleset: rs, client: 'surge' });
    expect(surge.json.lines).toContain('DOMAIN,same.test');
    const profile = await alice.post('/api/profiles', { name: '改写输出', nodeSets: [], overlay: { extraRules: [{ anchor: 'top', rule: { id: 'r', matcher: { kind: 'ruleset', id: rs.id }, target: { kind: 'builtin', name: 'DIRECT' } } }] } });
    const rendered = await renderer.render(profile.json.item.id, { client: 'mihomo' });
    expect(rendered.ok).toBe(true);
    expect(rendered.ok && Object.values(rendered.render.rulesets).join('')).toContain('changed.test');
    expect(rendered.ok && activeLines(Object.values(rendered.render.rulesets).join('\n').split('\n')).join('\n')).not.toContain('same.test');
    const removed = await alice.put(`/api/rulesets/${rs.id}`, { ...rs, overrides: [] });
    const restored = await alice.post('/api/rulesets/preview', { ruleset: removed.json.item, client: 'mihomo' });
    expect(restored.json.lines).toContain('DOMAIN,same.test');
    const rerendered = await renderer.render(profile.json.item.id, { client: 'mihomo' });
    expect(rerendered.ok && Object.values(rerendered.render.rulesets).join('')).toContain('same.test');
    expect(rerendered.ok && Object.values(rerendered.render.rulesets).join('')).not.toContain('changed.test');
  });

  it('追加不需要内容匹配，保存重读、合并预览与实际渲染一致', async () => {
    const { alice, renderer } = await scenario();
    const overrides = [{ override: { when: { client: 'mihomo' }, action: { append: [{ type: 'DOMAIN', value: 'added.test' }] } } }];
    const created = await alice.post('/api/rulesets', { name: '追加', sources: [
      { id: 'a', kind: 'local', format: 'auto', content: 'DOMAIN,keep.test' },
    ], overrides });
    expect(created.status).toBe(201);
    const rs = (await alice.get(`/api/rulesets/${created.json.item.id}`)).json.item;
    expect(rs.overrides).toEqual(overrides);
    const preview = await alice.post('/api/rulesets/preview', { id: rs.id, ruleset: rs, client: 'mihomo' });
    expect(preview.status).toBe(200);
    expect(activeLines(preview.json.lines)).toEqual(['DOMAIN,keep.test', 'DOMAIN,added.test']);
    const surge = await alice.post('/api/rulesets/preview', { ruleset: rs, client: 'surge' });
    expect(activeLines(surge.json.lines)).toEqual(['DOMAIN,keep.test']);
    const profile = await alice.post('/api/profiles', { name: '追加输出', nodeSets: [], overlay: { extraRules: [{ anchor: 'top', rule: { id: 'r', matcher: { kind: 'ruleset', id: rs.id }, target: { kind: 'builtin', name: 'DIRECT' } } }] } });
    const rendered = await renderer.render(profile.json.item.id, { client: 'mihomo' });
    expect(rendered.ok).toBe(true);
    expect(rendered.ok && Object.values(rendered.render.rulesets).join('')).toContain('added.test');
  });

  it('保存与草稿预览拒绝行号、空内容和无效动作，避免保存后丢失改写或渲染崩溃', async () => {
    const { alice } = await scenario();
    const override = { when: { client: 'mihomo' }, action: { drop: true } };
    for (const item of [
      { override: { ...override, action: { append: [] } } },
      { override: { ...override, action: { append: [{ type: 'DOMAIN', value: ' ' }] } } },
      { override: { ...override, action: { append: [{ type: 'DOMAIN', value: 'a.test' }], drop: true } } },
      { match: 'DOMAIN,a.test', override: { ...override, action: { append: [{ type: 'DOMAIN', value: 'b.test' }] } } },
      { line: 1, override }, { match: ' ', override }, { match: 'DOMAIN,a.test', line: 1, override },
      { match: 'DOMAIN,a.test', override: { ...override, action: { replace: [] } } },
      { match: 'DOMAIN,a.test', override: { ...override, action: { replace: [{ type: 'UNKNOWN', value: 'x' }] } } },
    ]) {
      const ruleset = { name: '非法', sources: [{ id: 'a', kind: 'local', format: 'auto', content: 'DOMAIN,a.test' }], overrides: [item] };
      expect((await alice.post('/api/rulesets', ruleset)).status).toBe(400);
      expect((await alice.post('/api/rulesets/preview', { ruleset, client: 'mihomo' })).status).toBe(400);
    }
  });
});
