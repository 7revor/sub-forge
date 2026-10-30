// 查询参数资源入口的内置浏览器验收；仅内存库和虚构上游，无生产凭据。
import { serve } from '@hono/node-server';
import { resolve } from 'node:path';
import { createApp } from '../src/app.ts';
import { Store } from '../src/store.ts';
import { hashPassword } from '../src/crypto.ts';
import { SnapshotService } from '../src/snapshots.ts';
import { RenderService } from '../src/render.ts';
import { RuleRepoService } from '../src/rule-repos/service.ts';
import type { RepoCache } from '../src/rule-repos/git-cache.ts';
import { remoteRuleMatcher } from '@sub-forge/core';

const store = new Store(':memory:');
const user = store.createUser({ username: 'route-admin', passwordHash: await hashPassword('route-test-2026'), role: 'admin' });
store.createUser({ username: 'route-reader', passwordHash: await hashPassword('route-test-2026'), role: 'user' });
const direct = { kind: 'builtin' as const, name: 'DIRECT' as const };
store.put('source', { id: 'source', name: '验收节点订阅', url: 'https://fixture.test/nodes', pipeline: [] }, user.id);
store.put('ruleset', { id: 'public', name: '公共规则增强', sources: [{ id: 'local', kind: 'local', format: 'auto', content: '# 公共规则原文\nDOMAIN,public.example.test' }] }, user.id);
const config = { groups: [], rules: [
  { id: 'public-rule', matcher: { kind: 'ruleset' as const, id: 'public' }, target: direct },
  { id: 'private-rule', matcher: remoteRuleMatcher('https://fixture.test/Private.list'), target: direct },
], final: direct };
store.putTemplateVersion({ id: 'template', name: '内部模板', ...config });
store.put('profile', { id: 'profile', name: '入口迁移验收订阅', nodeSets: [{ ref: { type: 'source', id: 'source' }, output: 'provider' }], chains: [], overlay: {}, refPolicy: { default: 'wrap' }, routing: { mode: 'bound', templateId: 'template', groupAdditions: {} } }, user.id);
const fetcher = async (url: string) => url.endsWith('/nodes') ? { status: 200, body: 'proxies: [{name: 验收节点, type: socks5, server: node.example.test, port: 1080}]', userinfo: { upload: 0, download: 100, total: 1000 } } : { status: 200, body: '# 私有规则来源原文\nDOMAIN,private.example.test\n' };
const snapshots = new SnapshotService(store, fetcher);
const cache: RepoCache = {
  inspect: async () => ({ defaultBranch: 'master', branches: ['master'] }),
  sync: async repo => Object.fromEntries(repo.refs.map(ref => [ref, 'a'.repeat(40)])),
  files: async () => ['rule/Surge/Google/Google.list'],
  read: async () => '# 仓库文件原文\nDOMAIN,repository.example.test\n', remove: async () => {}, stop: async () => {},
};
const ruleRepos = new RuleRepoService(store, fetcher, Date.now, cache);
await ruleRepos.refresh('blackmatrix7'); ruleRepos.setEnabled('zydou', false);
const publicUrl = 'http://127.0.0.1:18727';
const renderer = new RenderService(store, snapshots, { publicUrl });
const app = createApp({ store, snapshots, renderer, ruleRepos, publicUrl, webDir: resolve('../web/dist') });
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 18727 });
console.log(`隔离验收 ${publicUrl}，账号 route-admin / route-reader，密码 route-test-2026`);
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true; store.closeEvents();
  if ('closeAllConnections' in server) server.closeAllConnections();
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  await ruleRepos.stop(); await snapshots.settled(); store.close();
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void stop().catch(error => { console.error(error); process.exitCode = 1; }); });
