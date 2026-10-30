// 列表布局验收：内存库、虚构数据、可控响应顺序；只监听本机，不访问外部上游。
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { ResourceService } from '../src/resources.ts';
import { RuleRepoService } from '../src/rule-repos/service.ts';
import type { RepoCache } from '../src/rule-repos/git-cache.ts';
import { addUser, setupApp } from './helpers.ts';

type Control = { holdLists?: boolean; holdDetails?: boolean; failLists?: boolean };
const controlPath = process.env.LIST_LAYOUT_CONTROL;
const control = async (): Promise<Control> => controlPath ? JSON.parse(await readFile(controlPath, 'utf8')) : {};
const publicUrl = 'http://list-layout.localhost:18947';
const fetcher = async (url: string) => ({ status: 200, body: url.includes('/nodes/')
  ? JSON.stringify({ proxies: Array.from({ length: 123 }, (_, i) => ({ name: `验收节点 ${i + 1}`, type: 'ss', server: 'example.test', port: 443, cipher: 'aes-128-gcm', password: 'fixture-only' })) })
  : 'DOMAIN,example.test' });
const env = setupApp({ now: Date.now, fetcher });
const user = await addUser(env.store, 'layout-admin', 'admin');
for (let i = 1; i <= 24; i++) {
  env.store.put('source', { id: `source-${i}`, name: `订阅源 ${String(i).padStart(2, '0')}`, note: i === 2 ? '较长备注用于确认固定列宽下仍可完整换行阅读，且不会挤动状态、时间和操作列。' : '布局验收', url: `https://fixture.test/nodes/${i}`, pipeline: [] }, user.id);
}
env.store.put('local', { id: 'local', name: '本地节点', note: '布局验收', proxies: [] }, user.id);
env.store.put('collection', { id: 'collection', name: '组合验收', members: [{ ref: { type: 'source', id: 'source-1' } }], pipeline: [] }, user.id);
env.store.put('ruleset', { id: 'ruleset', name: '增强集合验收', sources: [{ id: 'remote', kind: 'remote', url: 'https://fixture.test/rules', format: 'auto' }] }, user.id);
env.store.put('preset', { id: 'preset', name: '基础设置验收', version: 1, mihomo: {} });
env.store.putTemplateVersion({ id: 'template', name: '模板验收', version: 1, groups: [], rules: [], final: { kind: 'builtin', name: 'DIRECT' } });
env.store.put('profile', { id: 'profile', name: '配置订阅验收', template: { id: 'template', follow: 'latest' }, nodeSets: [{ ref: { type: 'collection', id: 'collection' }, output: 'provider' }], chains: [], overlay: {}, refPolicy: { default: 'wrap' } }, user.id);
const cache: RepoCache = {
  inspect: async () => ({ defaultBranch: 'main', branches: ['main'] }),
  sync: async repo => Object.fromEntries(repo.refs.map(ref => [ref, 'a'.repeat(40)])),
  files: async () => ['rules/demo.list'], read: async () => 'DOMAIN,example.test', remove: async () => {}, stop: async () => {},
};
const repos = new RuleRepoService(env.store, fetcher, Date.now, cache, env.snapshots);
env.store.db.prepare('UPDATE rule_repos SET enabled = 0').run();
const repo = await repos.addCustom({ name: '验收仓库', url: 'https://github.com/fixture/rules', scans: [{ ref: 'main', directory: 'rules', format: 'auto', client: 'any', groupBy: 'path' }] });
await repos.refresh(repo);
const resources = new ResourceService(env.store, env.snapshots, env.renderer);
await resources.tick();

let stopping = false;
const requests: Record<string, number> = {};
const app = new Hono();
app.get('/__fixture/requests', c => c.json(requests));
app.use('/api/*', async (c, next) => {
  const path = c.req.path;
  const list = c.req.method === 'GET' && /^\/api\/(sources|collections|locals|rulesets|profiles|templates|presets|rule-repos)$/.test(path);
  const detail = c.req.method === 'GET' && (/\/(cache|nodes)$/.test(path) || path.startsWith('/api/resource-links/'));
  if (list || detail) {
    requests[path] = (requests[path] ?? 0) + 1;
    while (!stopping) {
      const state = await control();
      if (list && state.failLists) return c.json({ error: '模拟列表请求失败，请重试。' }, 503);
      if (!(list ? state.holdLists : state.holdDetails)) break;
      await new Promise(resolve => setTimeout(resolve, 80));
    }
  }
  await next();
});
app.route('/', createApp({ ...env, resources, ruleRepos: repos, publicUrl, webDir: fileURLToPath(new URL('../../web/dist', import.meta.url)) }));
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 18947 });
console.log(`隔离验收：${publicUrl}；虚构账号 layout-admin，密码 password-123`);
async function stop() {
  if (stopping) return;
  stopping = true;
  env.store.closeEvents();
  await resources.stop();
  await repos.stop();
  await env.snapshots.settled();
  await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); if ('closeAllConnections' in server) server.closeAllConnections(); });
  env.store.close();
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void stop().catch(error => { console.error(error); process.exitCode = 1; }); });
