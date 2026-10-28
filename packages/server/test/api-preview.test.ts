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
