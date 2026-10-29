// 手动浏览器验收入口；只监听回环地址，所有用户和文档均在临时内存库中。
import { serve } from '@hono/node-server';
import { resolve } from 'node:path';
import { createApp } from '../src/app.ts';
import { setupRuleReferences } from './rule-reference-fixture.ts';

const env = await setupRuleReferences();
for (let i = 0; i < 35; i++) env.store.put('ruleset', { id: `sample-${i}`, name: `样本 ${String(i).padStart(2, '0')}`, sources: [{ id: 's', kind: 'local', format: 'auto', content: `DOMAIN,sample-${i}.example.test` }] }, env.user.id);
const app = createApp({ ...env, ruleRepos: env.repos, publicUrl: 'http://127.0.0.1:5186', webDir: resolve('../web/dist') });
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 5186 });
console.log('隔离验收：http://127.0.0.1:5186；账号 reference-admin，密码 password-123');
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  await env.stop();
}
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void stop().catch(error => { console.error(error); process.exitCode = 1; }); });
