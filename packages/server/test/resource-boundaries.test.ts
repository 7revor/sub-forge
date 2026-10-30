import { afterEach, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { ResourceService } from '../src/resources.ts';
import type { SharedRuleRecord } from '../src/shared-rules.ts';
import { setupApp } from './helpers.ts';

const envs: ReturnType<typeof setupApp>[] = [];
afterEach(async () => { for (const h of envs.splice(0)) { await h.snapshots.settled(); h.store.close(); } });
function gate() { let release!: () => void; const promise = new Promise<void>(r => release = r); return { promise, release }; }
function setup() {
  const fetcher = vi.fn(async (_url: string) => ({ status: 200, body: 'DOMAIN,example.test' }));
  const h = setupApp({ fetcher }); envs.push(h);
  const user = h.store.createUser({ username: 'owner', passwordHash: 'fixture', role: 'admin' });
  const token = h.store.userToken(user.id)!.token;
  h.store.put('ruleset', { id: 'r', name: '公共规则', sources: ['a', 'b'].map(id => ({ id, kind: 'remote', format: 'auto', url: `https://rules.test/${id}` })) }, user.id);
  h.store.put('profile', { id: 'p', name: '订阅', nodeSets: [], overlay: {}, refPolicy: { default: 'wrap' }, chains: [], routing: { mode: 'independent', config: {
    groups: [], rules: [{ id: 'rule', matcher: { kind: 'ruleset', id: 'r' }, target: { kind: 'builtin', name: 'DIRECT' } }], final: { kind: 'builtin', name: 'DIRECT' },
  } } }, user.id);
  const main = async () => { const res = await h.app.request(`/sub/${token}/p`); expect(res.status, await res.clone().text()).toBe(200); return parse(await res.text()); };
  return { ...h, fetcher, user, token, main };
}
const ruleUrl = (config: any): string => Object.values<{ url: string }>(config['rule-providers'])[0]!.url;

it('多来源公共规则在首个拉取期间删除后，不再启动后续来源或重建绑定', async () => {
  const h = setup(), url = ruleUrl(await h.main()), entered = gate(), held = gate();
  h.fetcher.mockClear().mockImplementation(async () => { entered.release(); await held.promise; return { status: 200, body: 'DOMAIN,late.test' }; });
  h.advance(86400001); const pending = h.app.request(url); await entered.promise;
  h.store.delete('profile', 'p'); h.store.delete('ruleset', 'r'); held.release();
  expect((await pending).status).toBe(404);
  expect(h.fetcher).toHaveBeenCalledTimes(1);
  expect(h.store.db.prepare('SELECT * FROM resource_bindings').all()).toEqual([]);
  expect(h.store.db.prepare('SELECT * FROM snapshots').all()).toEqual([]);
});

it('节点依赖串行拉取期间删除订阅及来源，不拉取已删除的后续来源', async () => {
  const h = setup(), entered = gate(), held = gate();
  for (const id of ['a', 'b']) h.store.put('source', { id, name: id, url: `https://nodes.test/${id}`, pipeline: [] }, h.user.id);
  h.store.put('profile', { ...h.store.get('profile', 'p')!, nodeSets: ['a', 'b'].map(id => ({ ref: { type: 'source', id }, output: 'provider' })) }, h.user.id);
  h.fetcher.mockImplementation(async () => { entered.release(); await held.promise; return { status: 200, body: 'trojan://fixture@node.test:443#节点' }; });
  const pending = h.app.request(`/sub/${h.token}/p`); await entered.promise;
  h.store.delete('profile', 'p'); for (const id of ['a', 'b']) h.store.delete('source', id); held.release();
  expect((await pending).status).toBe(404); expect(h.fetcher).toHaveBeenCalledTimes(1);
  expect(h.store.db.prepare("SELECT * FROM resource_bindings WHERE kind='source'").all()).toEqual([]);
  expect(h.store.db.prepare("SELECT * FROM snapshots WHERE owner_kind='source'").all()).toEqual([]);
});

it.each([false, true])('删除规则增强时，正在执行的刷新任务不能重新写回（重建同 ID：%s）', async recreate => {
  const h = setup(), entered = gate(), held = gate();
  h.fetcher.mockImplementation(async () => { entered.release(); await held.promise; return { status: 200, body: 'DOMAIN,late.test' }; });
  const service = new ResourceService(h.store, h.snapshots, h.renderer);
  const job = service.startJob(h.user.id, 'ruleset', 'r'); await entered.promise;
  const original = h.store.get('ruleset', 'r')!;
  h.store.delete('profile', 'p'); h.store.delete('ruleset', 'r');
  if (recreate) h.store.put('ruleset', original, h.user.id);
  held.release(); await service.stop();
  expect(service.getJob(job.id)).toBeUndefined();
  expect(h.store.invalidationListeners.size).toBe(0);
});

it('后台刷新排队期间删除的来源不会重新被请求', async () => {
  const h = setup(), entered = gate(), held = gate();
  h.store.delete('profile', 'p'); h.store.delete('ruleset', 'r');
  for (let i = 0; i < 6; i++) h.store.put('source', { id: `s${i}`, name: `源${i}`, url: `https://nodes.test/${i}`, pipeline: [] }, h.user.id);
  let calls = 0;
  h.fetcher.mockImplementation(async () => { if (++calls === 4) entered.release(); await held.promise; return { status: 200, body: 'trojan://fixture@node.test:443#节点' }; });
  const service = new ResourceService(h.store, h.snapshots, h.renderer), pending = service.tick(); await entered.promise;
  h.store.delete('source', 's4'); h.store.delete('source', 's5'); held.release(); await pending; await service.stop();
  expect(calls).toBe(4);
});

it('公共规则从文本改成 MRS 后生成独立变体，旧文本链接不返回二进制', async () => {
  const h = setup(), oldUrl = ruleUrl(await h.main());
  h.store.put('ruleset', { id: 'r', name: '公共规则', sources: [{ id: 'binary', kind: 'remote', format: 'mrs', behavior: 'domain', url: 'https://rules.test/a.mrs' }] }, h.user.id);
  h.fetcher.mockResolvedValue({ status: 200, body: '#subforge-binary-mrs\n' + Buffer.from('模拟已校验的二进制').toString('base64') });
  const newUrl = ruleUrl(await h.main()); expect(newUrl).not.toBe(oldUrl);
  const old = await h.app.request(oldUrl); expect(old.headers.get('content-type')).toContain('text/plain'); expect(await old.text()).toContain('DOMAIN,example.test');
  expect((await h.app.request(newUrl)).headers.get('content-type')).toBe('application/octet-stream');
});

it('私有 provider 的原型属性路径视为不存在', async () => {
  const h = setup();
  h.store.put('local', { id: 'nodes', name: '节点', proxies: [{ name: '节点', type: 'socks5', server: 'node.test', port: 1080 }] }, h.user.id);
  h.store.put('profile', { ...h.store.get('profile', 'p')!, nodeSets: [{ ref: { type: 'local', id: 'nodes' }, output: 'provider' }] }, h.user.id);
  const config = await h.main(), url = new URL(config['proxy-providers']['节点'].url);
  url.pathname = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1) + '__proto__';
  expect((await h.app.request(url.href)).status).toBe(404);
});

it('未记录输出契约的旧 MRS 资源不能被当前文本配置覆盖', async () => {
  const h = setup();
  h.store.put('ruleset', { id: 'r', name: '公共规则', sources: [{ id: 'binary', kind: 'remote', format: 'mrs', behavior: 'domain', url: 'https://rules.test/a.mrs' }] }, h.user.id);
  h.fetcher.mockResolvedValue({ status: 200, body: '#subforge-binary-mrs\n' + Buffer.from('模拟已校验的二进制').toString('base64') });
  const oldUrl = ruleUrl(await h.main()), key = new URL(oldUrl).pathname.split('/').at(-1)!;
  const { delivery: _legacyMissing, ...legacy } = h.store.getSharedRule<SharedRuleRecord>(key)!;
  h.store.putSharedRule(key, 'r', legacy);
  h.store.put('ruleset', { id: 'r', name: '公共规则', sources: [{ id: 'text', kind: 'local', format: 'auto', content: 'DOMAIN,new.test' }] }, h.user.id);
  const response = await h.app.request(oldUrl);
  expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe('application/octet-stream');
  expect(response.headers.get('x-sub-forge-warning')).toBe('last-good-rule');
  expect(await response.text()).toBe('模拟已校验的二进制');
  expect(ruleUrl(await h.main())).not.toBe(oldUrl);
});
