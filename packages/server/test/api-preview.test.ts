import { describe, expect, it } from 'vitest';
import type { UpstreamFetcher } from '../src/net/upstream.ts';
import { addUser, client, setupApp } from './helpers.ts';

const AIRPORT = 'trojan://pw@a.example.com:443#香港 01 | 0.5x\ntrojan://pw@b.example.com:443#剩余流量：10G\ntrojan://pw@c.example.com:443#日本 03';

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
  it('订阅源：按草稿处理链逐步执行，返回每步节点与差异', async () => {
    const { alice } = await scenario();
    const id = (await alice.post('/api/sources', { name: 'A', kind: 'local', content: AIRPORT, pipeline: [] })).json.item.id;
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
    const { alice, bob } = await scenario();
    const id = (await alice.post('/api/sources', { name: 'A', kind: 'local', content: AIRPORT, pipeline: [] })).json.item.id;
    expect((await alice.post(`/api/sources/${id}/pipeline-preview`, { pipeline: [{ op: 'filter.regex', patterns: ['(['], keep: true }] })).status).toBe(400);
    expect((await bob.post(`/api/sources/${id}/pipeline-preview`, {})).status).toBe(404);
  });

  it('组合：成员先跑各自处理链与前缀，再逐步执行组合自身的处理链', async () => {
    const { alice } = await scenario();
    const a = (await alice.post('/api/sources', { name: 'A', kind: 'local', content: AIRPORT, pipeline: [{ op: 'filter.useless' }] })).json.item.id;
    const b = (await alice.post('/api/sources', { name: 'B', kind: 'local', content: 'trojan://pw@d.example.com:443#香港 09', pipeline: [] })).json.item.id;
    const col = (await alice.post('/api/collections', { name: 'C', members: [{ ref: { type: 'source', id: a }, prefix: 'A·' }, { ref: { type: 'source', id: b }, prefix: 'B·' }], pipeline: [] })).json.item.id;
    const res = await alice.post(`/api/collections/${col}/pipeline-preview`, { pipeline: [{ op: 'sort.name', order: 'desc' }] });
    expect(res.json.input).toBe(3);
    expect(res.json.nodes.map((n: { name: string }) => n.name)).toEqual(['B·香港 09', 'A·香港 01 | 0.5x', 'A·日本 03']);
  });
});

describe('立即拉取与快照', () => {
  it('远程订阅源：立即拉取、快照历史、失败时带原因', async () => {
    let fail = false;
    const { alice } = await scenario(async (url) => {
      if (fail) throw new Error('HTTP 502');
      return { status: 200, body: AIRPORT, userinfo: { total: 100 } };
    });
    const id = (await alice.post('/api/sources', { name: 'R', kind: 'remote', urls: ['https://air.example.com/sub'] })).json.item.id;
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
  it('按客户端与平台输出，列出降级、丢弃与无法解析的行', async () => {
    const { alice } = await scenario();
    const content = 'DOMAIN-SUFFIX,notion.so\nPROCESS-NAME-REGEX,^steam.*\nPROCESS-PATH-WILDCARD,/Applications/*/Slack.app/*\nIP-CIDR,1.1.1.0/24,no-resolve\nUSER-AGENT,x*';
    const id = (await alice.post('/api/rulesets', { name: 'R', kind: 'local', format: 'auto', content })).json.item.id;
    const mihomo = await alice.post(`/api/rulesets/${id}/preview`, { client: 'mihomo' });
    expect(mihomo.json.lines).toEqual(['DOMAIN-SUFFIX,notion.so', 'PROCESS-NAME-REGEX,^steam.*', 'PROCESS-PATH-WILDCARD,/Applications/*/Slack.app/*', 'IP-CIDR,1.1.1.0/24,no-resolve']);
    expect(mihomo.json.rejected.map((r: { reason: string }) => r.reason)).toEqual(['不支持的规则类型 USER-AGENT']);
    const mac = await alice.post(`/api/rulesets/${id}/preview`, { client: 'surge', platform: 'macos' });
    expect(mac.json.lines).toContain('PROCESS-NAME,steam*');
    expect(mac.json.notes).toHaveLength(1);
    const ios = await alice.post(`/api/rulesets/${id}/preview`, { client: 'surge', platform: 'ios' });
    expect(ios.json.lines).toEqual(['DOMAIN-SUFFIX,notion.so', 'IP-CIDR,1.1.1.0/24,no-resolve']);
    expect(ios.json.dropped).toHaveLength(2);
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

  it('本地订阅源使用保存的改名与过滤，组合继续执行成员前缀和自身处理链', async () => {
    const { alice } = await scenario();
    const source = (await alice.post('/api/sources', {
      name: '源', kind: 'local', content: AIRPORT,
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
    const body = { source: { name: '源', kind: 'local', content: AIRPORT }, collection: { name: '组合', members: [] }, local: { name: '本地组', proxies: [] } }[type];
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

  it('返回快照加载与解析报告，读取有效快照不重复拉取', async () => {
    let calls = 0;
    const { alice, advance } = await scenario(async (url) => {
      calls++;
      if (url.endsWith('/bad')) throw new Error('上游不可用');
      return { status: 200, body: AIRPORT + '\ntrojan://broken' };
    });
    const id = (await alice.post('/api/sources', { name: '远程源', kind: 'remote', urls: ['https://example.com/good', 'https://example.com/bad'] })).json.item.id;
    const res = await alice.get(`/api/nodesets/source/${id}/nodes`);
    expect(res.status).toBe(200);
    expect(res.json.total).toBe(3);
    expect(res.json.report.map((r: { code: string }) => r.code)).toEqual(['source.fetch-failed', 'source.parse-failure']);
    expect(calls).toBe(2);
    // 刚失败的地址在退避期内不重试，仍报告失败；有效快照对应的地址不再拉取。
    const again = await alice.get(`/api/nodesets/source/${id}/nodes`);
    expect(again.json.report.map((r: { code: string }) => r.code)).toContain('source.fetch-failed');
    expect(calls).toBe(2);
    // 退避期过后，从未成功的地址重试。
    advance(301_000);
    await alice.get(`/api/nodesets/source/${id}/nodes`);
    expect(calls).toBe(3);
  });
});
