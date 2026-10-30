import { afterEach, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { setupApp } from './helpers.ts';
import type { TrafficInfo } from '../src/store.ts';

const active: ReturnType<typeof setupApp>[] = [];
afterEach(async () => { for (const h of active.splice(0)) { await h.snapshots.settled(); h.store.close(); } });
function gate() { let release!: () => void; const promise = new Promise<void>(r => release = r); return { promise, release }; }
function setup() {
  const info: Record<string, TrafficInfo | undefined> = { a: { upload: 0, download: 10, total: 1000, expire: 2000000000 }, b: { download: 20, total: 2000, expire: 1900000000 } };
  let fail = false;
  const fetcher = vi.fn(async (url: string) => {
    if (fail) throw new Error('模拟上游失败');
    const id = url.split('/').at(-1)!;
    return url.includes('rules.test') ? { status: 200, body: 'DOMAIN,example.test\nUSER-AGENT,Example*' } : { status: 200, body: `proxies: [{name: ${id}, type: socks5, server: node.test, port: 1080}]`, userinfo: info[id] };
  });
  const h = setupApp({ fetcher }); active.push(h);
  const a = h.store.createUser({ username: 'a', passwordHash: 'fixture', role: 'admin' }), b = h.store.createUser({ username: 'b', passwordHash: 'fixture', role: 'user' });
  const token = h.store.userToken(a.id)!.token, other = h.store.userToken(b.id)!.token;
  const session = h.store.createSession(a.id, 3600000), otherSession = h.store.createSession(b.id, 3600000);
  const api = (path: string, user = 'a') => h.app.request(`/api${path}`, { headers: { cookie: `sf_session=${user === 'a' ? session : otherSession}` } });
  for (const id of ['a', 'b']) h.store.put('source', { id, name: id, url: `https://nodes.test/${id}`, pipeline: [] }, a.id);
  h.store.put('source', { id: 'duplicate', name: '重复地址', url: 'https://nodes.test/a', pipeline: [] }, a.id);
  h.store.put('collection', { id: 'c', name: '组合', members: ['a', 'b', 'a', 'duplicate'].map(id => ({ ref: { type: 'source', id } })), pipeline: [] }, a.id);
  h.store.put('local', { id: 'l', name: '本地', proxies: [{ name: '本地节点', type: 'socks5', server: 'node.test', port: 1080 }] }, a.id);
  h.store.put('ruleset', { id: 'r', name: '公共增强', sources: [{ id: 's', kind: 'remote', format: 'auto', url: 'https://rules.test/a' }] }, a.id);
  h.store.put('profile', { id: 'p', name: '订阅', nodeSets: [{ ref: { type: 'collection', id: 'c' }, output: 'provider' }], chains: [], overlay: {}, refPolicy: { default: 'wrap' }, routing: { mode: 'independent', config: {
    groups: [], rules: [{ id: 'r', matcher: { kind: 'ruleset', id: 'r' }, target: { kind: 'builtin', name: 'DIRECT' } }], final: { kind: 'builtin', name: 'DIRECT' },
  } } }, a.id);
  return { ...h, a, b, token, other, api, fetcher, info, fail: () => { fail = true; } };
}

it('五类复制链接使用当前用户 token，公共规则可复制他人定义，私有对象不越权，也不预抓取', async () => {
  const h = setup();
  for (const [kind, id, path] of [['sources', 'a', 'nodes'], ['collections', 'c', 'nodes'], ['locals', 'l', 'nodes'], ['profiles', 'p', 'sub'], ['rulesets', 'r', 'rules']]) {
    const response = await h.api(`/resource-links/${kind}/${id}`);
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ item: { userId: h.a.id, token: h.token, url: expect.stringContaining(`/${path}/${h.token}/`) } });
    expect((await h.api(`/resource-links/${kind}/${id}`, 'b')).status).toBe(kind === 'rulesets' ? 200 : 404);
  }
  expect(await (await h.api('/resource-links/rulesets/r', 'b')).json()).toMatchObject({ item: { userId: h.b.id, token: h.other, url: `https://sub.test/rules/${h.other}/r` } });
  expect((await h.app.request('/api/resource-links/rulesets/r')).status).toBe(401);
  expect((await h.api('/resource-links/__proto__/r')).status).toBe(404);
  expect(h.fetcher).not.toHaveBeenCalled(); expect(h.store.listSharedRules()).toEqual([]);
  const next = h.store.resetToken(h.token)!;
  expect(await (await h.api('/resource-links/sources/a')).json()).toMatchObject({ item: { token: next.token, url: `https://sub.test/nodes/${next.token}/source/a` } });
});

it('未被订阅引用的增强可独立下载，按 UA 转换，共享产物和原文，不创建私有配置', async () => {
  const h = setup(); h.store.delete('profile', 'p');
  const mihomo = await h.app.request(`/rules/${h.other}/r`, { headers: { 'user-agent': 'clash.meta' } });
  expect(mihomo.status).toBe(200); expect(await mihomo.text()).toContain('# [mihomo 不支持 USER-AGENT]');
  const stash = await h.app.request(`/rules/${h.token}/r`, { headers: { 'user-agent': 'Stash/3.6.0' } });
  expect(stash.status).toBe(200); expect(await stash.text()).toContain('USER-AGENT,Example*');
  expect(h.store.listSharedRules()).toHaveLength(2); expect(h.fetcher).toHaveBeenCalledTimes(1);
  expect(h.store.db.prepare('SELECT * FROM last_good').all()).toEqual([]);
  h.store.updateUser(h.a.id, { disabled: true });
  expect((await h.app.request(`/rules/${h.other}/r`)).status).toBe(200);
  expect((await h.app.request(`/rules/${h.token}/r`)).status).toBe(404);
  h.store.delete('ruleset', 'r'); expect((await h.app.request(`/rules/${h.other}/r`)).status).toBe(404);
});

it('独立规则链接与配置规则引用复用相同产物，失败首次生成不留下空产物', async () => {
  const h = setup(); h.fail();
  expect((await h.app.request(`/rules/${h.token}/r`)).status).toBe(503); expect(h.store.listSharedRules()).toEqual([]);
  h.store.put('ruleset', { id: 'r', name: '公共增强', sources: [{ id: 'local', kind: 'local', format: 'auto', content: 'DOMAIN,local.test' }] }, h.a.id);
  expect((await h.app.request(`/rules/${h.token}/r`)).status).toBe(200);
  // 使用本地节点避免上游模拟失败干扰配置生成。
  h.store.put('profile', { ...h.store.get('profile', 'p')!, nodeSets: [{ ref: { type: 'local', id: 'l' }, output: 'provider' }] }, h.a.id);
  expect((await h.app.request(`/sub/${h.token}/p`)).status).toBe(200); expect(h.store.listSharedRules()).toHaveLength(1);
});

it.each(['clash.meta', 'Stash/3.6.0'])('节点链接向 %s 的 GET 和 HEAD 返回流量，失败使用上次成功流量，成功缺失后清除', async ua => {
  const h = setup(), url = `/nodes/${h.token}/source/a`, headers = { 'user-agent': ua };
  const first = await h.app.request(url, { headers });
  expect(first.status).toBe(200); expect(first.headers.get('subscription-userinfo')).toBe('upload=0; download=10; total=1000; expire=2000000000');
  expect(parse(await first.text()).proxies).toHaveLength(1);
  const head = await h.app.request(url, { method: 'HEAD', headers }); expect(head.status).toBe(200); expect(await head.text()).toBe(''); expect(head.headers.get('subscription-userinfo')).toBe(first.headers.get('subscription-userinfo'));
  expect(h.fetcher).toHaveBeenCalledTimes(1);
  h.info.a = undefined; h.advance(86400001);
  expect((await h.app.request(url, { headers })).headers.get('subscription-userinfo')).toBeNull();
  h.info.a = { download: 30, total: 1000 }; h.advance(86400001);
  expect((await h.app.request(url, { headers })).headers.get('subscription-userinfo')).toBe('download=30; total=1000');
  h.fail(); h.advance(86400001);
  expect((await h.app.request(url, { headers })).headers.get('subscription-userinfo')).toBe('download=30; total=1000');
});

it('组合按唯一上游累计已知字段和最早到期，内部 provider 带对应流量，本地节点不伪造', async () => {
  const h = setup(), expected = 'upload=0; download=30; total=3000; expire=1900000000';
  expect((await h.app.request(`/nodes/${h.token}/collection/c`)).headers.get('subscription-userinfo')).toBe(expected);
  expect((await h.app.request(`/nodes/${h.token}/local/l`)).headers.get('subscription-userinfo')).toBeNull();
  const main = parse(await (await h.app.request(`/sub/${h.token}/p`)).text());
  const provider = await h.app.request(main['proxy-providers']['组合'].url, { method: 'HEAD' });
  expect(provider.status).toBe(200); expect(provider.headers.get('subscription-userinfo')).toBe(expected); expect(await provider.text()).toBe('');
});

it('节点自带前置在独立节点订阅中引用同一文件中的节点，不留下未输出的隐藏组', async () => {
  const h = setup();
  h.fetcher.mockResolvedValue({ status: 200, body: 'proxies: [{name: 前置, type: socks5, server: a.test, port: 1080}, {name: 落地, type: socks5, server: b.test, port: 1080, dialer-proxy: 前置}]' });
  const response = await h.app.request(`/nodes/${h.token}/source/a`); expect(response.status).toBe(200);
  const nodes = parse(await response.text()).proxies;
  expect(nodes.find((n: any) => n.name === '落地')['dialer-proxy']).toBe('前置');
});

it.each(['sub', 'provider', 'nodes', 'rules', 'variant'].flatMap(kind => ['reset', 'disable'].map(action => [kind, action] as const)))('%s 在途请求遇到 %s 立即拒绝，不返回流量头', async (kind, action) => {
  const h = setup(), config = parse(await (await h.app.request(`/sub/${h.token}/p`)).text());
  const entered = gate(), held = gate();
  const original = h.fetcher.getMockImplementation()!;
  h.fetcher.mockImplementation(async url => { entered.release(); await held.promise; return original(url); }); h.advance(86400001);
  const paths: Record<string, string> = { sub: `/sub/${h.token}/p`, provider: config['proxy-providers']['组合'].url, nodes: `/nodes/${h.token}/collection/c`, rules: `/rules/${h.token}/r`, variant: Object.values<{ url: string }>(config['rule-providers'])[0]!.url };
  const pending = h.app.request(paths[kind]!); await entered.promise; if (action === 'reset') h.store.resetToken(h.token); else h.store.updateUser(h.a.id, { disabled: true }); held.release();
  const response = await pending; expect(response.status).toBe(404); expect(response.headers.get('subscription-userinfo')).toBeNull();
});

it('首次生成规则时删除并重建同 ID，也不允许旧请求写入新资源', async () => {
  const h = setup(), entered = gate(), held = gate();
  h.fetcher.mockImplementation(async () => { entered.release(); await held.promise; return { status: 200, body: 'DOMAIN,old.test' }; });
  const pending = h.app.request(`/rules/${h.token}/r`); await entered.promise;
  const rule = h.store.get('ruleset', 'r')!;
  h.store.delete('profile', 'p'); h.store.delete('ruleset', 'r'); h.store.put('ruleset', { ...rule, sources: [{ id: 'local', kind: 'local', format: 'auto', content: 'DOMAIN,new.test' }] }, h.a.id);
  held.release(); expect((await pending).status).toBe(404); expect(h.store.listSharedRules()).toEqual([]);
  expect(await (await h.app.request(`/rules/${h.token}/r`)).text()).toBe('DOMAIN,new.test\n');
  expect(h.store.invalidationListeners.size).toBe(0);
});

it('旧组合的处理链预览和复制链接不能读取外用户成员', async () => {
  const h = setup();
  h.store.put('source', { id: 'foreign', name: '其他用户源', url: 'https://nodes.test/foreign', pipeline: [] }, h.b.id);
  h.store.put('collection', { id: 'c', name: '损坏组合', members: [{ ref: { type: 'source', id: 'foreign' } }], pipeline: [] }, h.a.id);
  const session = h.store.createSession(h.a.id, 3600000);
  const preview = await h.app.request('/api/collections/c/pipeline-preview', { method: 'POST', headers: { cookie: `sf_session=${session}`, 'content-type': 'application/json' }, body: '{}' });
  expect(preview.status).toBe(404); expect((await h.api('/resource-links/collections/c')).status).toBe(404);
  expect(h.fetcher).not.toHaveBeenCalled();
});


it.each(['Surge iOS/3412', 'Loon/3.5.3'])('%s 独立节点与公共规则延续客户端输出并保留流量', async ua => {
  const h = setup(), headers = { 'user-agent': ua };
  const node = await h.app.request(`/nodes/${h.token}/source/a`, { headers });
  expect(node.status, await node.clone().text()).toBe(200);
  expect(await node.text()).toContain('a = socks5');
  expect(node.headers.get('subscription-userinfo')).toContain('download=10');
  const head = await h.app.request(`/nodes/${h.token}/source/a`, { headers, method: 'HEAD' });
  expect(head.headers.get('subscription-userinfo')).toBe(node.headers.get('subscription-userinfo'));
  expect(await head.text()).toBe('');
  expect(await (await h.app.request(`/rules/${h.token}/r`, { headers })).text()).toContain('DOMAIN,example.test');
  for (const path of [`/nodes/${h.token}/source/a`, `/rules/${h.token}/r`]) {
    expect((await h.app.request(path + '?target=unknown')).status).toBe(400);
    expect((await h.app.request(path + '?target=loon&platform=linux')).status).toBe(400);
  }
});
