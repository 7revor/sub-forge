import { afterEach, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { remoteRuleMatcher, type Matcher } from '@sub-forge/core';
import { ResourceService } from '../src/resources.ts';
import { setupApp } from './helpers.ts';

const envs: ReturnType<typeof setupApp>[] = [];
afterEach(async () => { for (const h of envs.splice(0)) { await h.snapshots.settled(); h.store.close(); } });
function setup() {
  let body = 'DOMAIN,one.test', fail = false;
  const fetcher = vi.fn(async () => { if (fail) throw new Error('模拟上游故障'); return { status: 200, body }; });
  const h = setupApp({ fetcher }); envs.push(h);
  const a = h.store.createUser({ username: 'a', passwordHash: 'fixture', role: 'admin' });
  const b = h.store.createUser({ username: 'b', passwordHash: 'fixture', role: 'user' });
  const tokenA = h.store.userToken(a.id)!.token, tokenB = h.store.userToken(b.id)!.token;
  const session = h.store.createSession(a.id, 3600000);
  const api = (url: string, method = 'GET') => h.app.request(`/api${url}`, { method, headers: { cookie: `sf_session=${session}` } });
  const profile = (id: string, owner: string, matcher: Matcher = { kind: 'ruleset', id: 'r' }) => h.store.put('profile', {
    id, name: id, nodeSets: [], overlay: {}, chains: [], refPolicy: { default: 'wrap' }, routing: { mode: 'independent', config: {
      groups: [], rules: [{ id: 'rule', matcher, target: { kind: 'builtin', name: 'DIRECT' } }], final: { kind: 'builtin', name: 'DIRECT' },
    } },
  }, owner);
  h.store.put('ruleset', { id: 'r', name: '规则增强', sources: [{ id: 's', kind: 'remote', url: 'https://rules.test/common.list', format: 'auto' }] }, a.id);
  const main = async (token: string, id: string, query = '') => { const res = await h.app.request(`/sub/${token}/${id}${query}`); expect(res.status, await res.clone().text()).toBe(200); return parse(await res.text()); };
  return { ...h, a, b, tokenA, tokenB, profile, main, api, fetcher, update: (next: string) => { body = next; h.advance(86400001); }, fail: () => { fail = true; h.advance(86400001); } };
}
const ruleUrl = (config: any): string => Object.values<{ url: string }>(config['rule-providers'])[0]!.url;

it('不同用户同规则同处理共用产物和原文，平台变体独立，主配置不复制规则正文', async () => {
  const h = setup(); h.profile('a', h.a.id); h.profile('b', h.b.id);
  const a = await h.main(h.tokenA, 'a'), b = await h.main(h.tokenB, 'b');
  expect(ruleUrl(a).replace(h.tokenA, '')).toBe(ruleUrl(b).replace(h.tokenB, ''));
  expect(Object.keys(a['rule-providers'])).toEqual(['规则增强']);
  expect(h.store.listSharedRules()).toHaveLength(1); expect(h.fetcher).toHaveBeenCalledTimes(1);
  expect(h.store.getLastGood('a', 'mihomo:any')!.data).not.toHaveProperty('rulesets');
  const stash = await h.main(h.tokenB, 'b', '?target=stash&platform=ios');
  expect(ruleUrl(stash)).not.toBe(ruleUrl(b)); expect(h.store.listSharedRules()).toHaveLength(2);
  expect(h.fetcher).toHaveBeenCalledTimes(1);
  expect((await h.app.request(`/sub/${h.tokenB}/a`)).status).toBe(404);
  expect((await h.app.request(ruleUrl(a).replace(h.tokenA, h.tokenB))).status).toBe(200);
  expect((await h.app.request(ruleUrl(a).replace(h.tokenA, 'invalid'))).status).toBe(404);
});

it('删除订阅只清理私有产物；公共规则继续更新，删除规则定义清理全部变体和最后原文', async () => {
  const h = setup(); h.profile('a', h.a.id);
  const url = ruleUrl(await h.main(h.tokenA, 'a'));
  await h.main(h.tokenA, 'a', '?target=stash&platform=ios');
  h.store.delete('profile', 'a');
  expect(h.store.getActiveToken(h.tokenA)).toBeDefined();
  expect(h.store.db.prepare('SELECT * FROM last_good').all()).toEqual([]);
  expect(h.store.db.prepare('SELECT * FROM render_generations').all()).toEqual([]);
  h.update('DOMAIN,two.test'); expect(await (await h.app.request(url)).text()).toBe('DOMAIN,two.test\n');
  h.store.delete('ruleset', 'r');
  expect((await h.app.request(url)).status).toBe(404);
  expect(h.store.listSharedRules()).toEqual([]);
  expect(h.store.db.prepare('SELECT * FROM resource_bindings').all()).toEqual([]);
  expect(h.store.db.prepare('SELECT * FROM snapshots').all()).toEqual([]);
});

it('直接 URL 公共资源在订阅删除后保留，可由管理员清理，引用中的资源禁止删除', async () => {
  const h = setup(); h.profile('a', h.a.id, remoteRuleMatcher('https://rules.test/Apple.list?download=1'));
  const cfg = await h.main(h.tokenA, 'a'), url = ruleUrl(cfg), key = new URL(url).pathname.split('/').at(-1)!;
  expect(Object.keys(cfg['rule-providers'])).toEqual(['Apple']);
  expect((await h.api(`/system/rule-resources/${key}`, 'DELETE')).status).toBe(409);
  h.store.delete('profile', 'a'); expect((await h.app.request(url.replace(h.tokenA, h.tokenB))).status).toBe(200);
  expect((await h.api('/system/rule-resources')).status).toBe(200);
  expect((await h.api(`/system/rule-resources/${key}`, 'DELETE')).status).toBe(200);
  expect((await h.app.request(url)).status).toBe(404);
  expect(h.store.db.prepare('SELECT * FROM resource_bindings').all()).toEqual([]);
  expect(h.store.db.prepare('SELECT * FROM snapshots').all()).toEqual([]);
});

it('旧转换 token 入口不可用，修改下载参数不能把规则资源变为任意 URL 代理', async () => {
  const h = setup(); h.profile('a', h.a.id);
  const url = ruleUrl(await h.main(h.tokenA, 'a'));
  expect((await h.app.request(`/api/rules/convert?token=${h.tokenA}&url=https://foreign.test/x`)).status).toBe(404);
  expect(await (await h.app.request(`${url}?url=https://foreign.test/x&target=stash`)).text()).toBe('DOMAIN,one.test\n');
  expect(h.fetcher).toHaveBeenCalledTimes(1);
});

it('规则增强公共读取，普通用户不能修改他人定义；引用关系跨用户阻止删除', async () => {
  const h = setup(); h.profile('b', h.b.id);
  const session = h.store.createSession(h.b.id, 3600000), headers = { cookie: `sf_session=${session}`, 'content-type': 'application/json' };
  const detail = await h.app.request('/api/rulesets/r', { headers });
  expect(detail.status).toBe(200); expect(await detail.json()).toMatchObject({ writable: false });
  expect(await (await h.app.request('/api/rulesets', { headers })).json()).toMatchObject({ writableIds: [] });
  expect(await (await h.api('/rulesets')).json()).toMatchObject({ writableIds: ['r'] });
  expect((await h.app.request('/api/rulesets/r', { method: 'PUT', headers, body: JSON.stringify(h.store.get('ruleset', 'r')) })).status).toBe(403);
  expect((await h.app.request('/api/rulesets/r', { method: 'DELETE', headers })).status).toBe(403);
  expect((await h.api('/rulesets/r', 'DELETE')).status).toBe(409);
});

it('上游失败使用成功原文，改写不可用保留成功产物并暴露错误，修复后恢复', async () => {
  const h = setup(); h.profile('a', h.a.id); const url = ruleUrl(await h.main(h.tokenA, 'a'));
  h.fail(); expect(await (await h.app.request(url)).text()).toBe('DOMAIN,one.test\n');
  const rs = h.store.get('ruleset', 'r')!;
  h.store.put('ruleset', { ...rs, sources: [{ id: 's', kind: 'remote', url: 'https://rules.test/unsupported.srs', format: 'srs' }] }, h.a.id);
  const failed = await h.app.request(url); expect(await failed.text()).toBe('DOMAIN,one.test\n'); expect(failed.headers.get('x-sub-forge-warning')).toBe('last-good-rule');
  h.store.put('ruleset', { ...rs, sources: [{ id: 'l', kind: 'local', format: 'auto', content: 'DOMAIN,repaired.test' }] }, h.a.id);
  const repaired = await h.app.request(url); expect(await repaired.text()).toBe('DOMAIN,repaired.test\n'); expect(repaired.headers.get('x-sub-forge-warning')).toBeNull();
});

it('原始节点下载按用户隔离，历史配置也不能绕过节点归属变化', async () => {
  const h = setup();
  h.store.put('local', { id: 'nodes', name: '节点', proxies: [{ name: '节点一', type: 'socks5', server: 'node.test', port: 1080 }] }, h.a.id);
  h.profile('a', h.a.id);
  h.store.put('profile', { ...h.store.get('profile', 'a')!, nodeSets: [{ ref: { type: 'local', id: 'nodes' }, output: 'provider' }] }, h.a.id);
  const config = await h.main(h.tokenA, 'a'), provider = config['proxy-providers']['节点'].url;
  expect((await h.app.request(`/nodes/${h.tokenA}/local/nodes`)).status).toBe(200);
  expect((await h.app.request(`/nodes/${h.tokenB}/local/nodes`)).status).toBe(404);
  h.store.put('profile', { ...h.store.get('profile', 'a')!, nodeSets: [] }, h.a.id);
  h.store.db.prepare("UPDATE docs SET owner=? WHERE kind='local' AND id='nodes'").run(h.b.id);
  expect((await h.app.request(provider)).status).toBe(404);
  expect((await h.app.request(`/nodes/${h.tokenA}/local/nodes`)).status).toBe(404);
});

it('规则和订阅刷新在途删除不会恢复缓存、产物或刷新任务', async () => {
  const h = setup(); h.profile('a', h.a.id); const url = ruleUrl(await h.main(h.tokenA, 'a'));
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(r => entered = r), held = new Promise<void>(r => release = r);
  h.fetcher.mockImplementation(async () => { entered(); await held; return { status: 200, body: 'DOMAIN,late.test' }; });
  h.advance(86400001); const pending = h.app.request(url); await started;
  h.store.delete('profile', 'a'); h.store.delete('ruleset', 'r'); release();
  expect((await pending).status).toBe(404);
  expect(h.store.listSharedRules()).toEqual([]); expect(h.store.db.prepare('SELECT * FROM snapshots').all()).toEqual([]);
  h.profile('job', h.a.id, remoteRuleMatcher('https://rules.test/job.list'));
  let startedJob!: () => void, finishJob!: () => void;
  const waitJob = new Promise<void>(r => startedJob = r), holdJob = new Promise<void>(r => finishJob = r);
  h.fetcher.mockImplementation(async () => { startedJob(); await holdJob; return { status: 200, body: 'DOMAIN,job.test' }; });
  const service = new ResourceService(h.store, h.snapshots, h.renderer);
  const job = service.startJob(h.a.id, 'profile', 'job'); await waitJob;
  h.store.delete('profile', 'job'); finishJob(); await service.stop();
  expect(service.getJob(job.id)).toBeUndefined(); expect(h.store.db.prepare('SELECT * FROM snapshots').all()).toEqual([]);
});
