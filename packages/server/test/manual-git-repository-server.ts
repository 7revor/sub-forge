// Git 仓库管理验收：内存数据库、临时 Git 缓存、真实公开 Git 传输；HTTP 上游全部禁用。
import { serve } from '@hono/node-server';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../src/app.ts';
import { GitRepoCache } from '../src/rule-repos/git-cache.ts';
import { RuleRepoService } from '../src/rule-repos/service.ts';
import { addUser, setupApp } from './helpers.ts';

const root = await mkdtemp(join(tmpdir(), 'sf-git-browser-'));
let httpCalls = 0;
const fetcher = async () => { httpCalls++; throw new Error('本次验收禁止 HTTP 上游请求，仓库信息必须通过 Git 获取'); };
const env = setupApp({ fetcher, now: Date.now });
const repos = new RuleRepoService(env.store, fetcher, Date.now, new GitRepoCache(root));
for (const repo of repos.list()) repos.setEnabled(repo.id, false);
await addUser(env.store, 'git-test-admin', 'admin', 'git-test-password');
const app = createApp({ ...env, ruleRepos: repos, publicUrl: 'http://git-only.localhost:18744', webDir: resolve('../web/dist') });
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 18744 });
console.log('Git 验收：http://git-only.localhost:18744；测试账号 git-test-admin，密码 git-test-password');
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  const results = await Promise.allSettled([closed, repos.stop()]);
  await env.snapshots.settled(); env.store.close();
  await rm(root, { recursive: true, force: true });
  console.log(`验收期间 HTTP 上游请求次数：${httpCalls}`);
  const errors = results.filter(result => result.status === 'rejected');
  if (errors.length) throw new AggregateError(errors.map(result => result.reason), '验收服务清理失败');
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void stop().catch(error => { console.error(error); process.exitCode = 1; }); });
