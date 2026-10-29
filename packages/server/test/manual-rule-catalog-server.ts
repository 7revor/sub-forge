// 级联选择器隔离验收：模拟 Git 目录、虚构正文和内存数据，不连接生产数据库。
import { serve } from '@hono/node-server';
import { resolve } from 'node:path';
import { createApp } from '../src/app.ts';
import { setupRuleReferences } from './rule-reference-fixture.ts';
const env = await setupRuleReferences();
env.setPaths(['root.list', 'rule/Clash/China/China.list', 'rule/Clash/China/China_Domain.list', 'rule/Surge/China/China.list', 'rule/Clash/Cloud/Dropbox/Dropbox.txt', 'rule/Clash/China/README.md', 'rule/Clash/YamlOnly/file.yaml', 'rule/Clash/China/ignored.mrs']);
await env.repos.refresh('blackmatrix7');
const custom = await env.repos.addCustom({ url: 'https://github.com/example/catalog-fixture', name: '根目录示例', ref: 'master' });
await env.repos.refresh(custom);
const published = await env.admin.post('/api/templates/new/publish', { name: '级联模板', groups: [], rules: [], final: { kind: 'builtin', name: 'DIRECT' } });
if (published.status !== 201) throw new Error(published.text);
const profile = await env.admin.post('/api/profiles', { name: '级联订阅', nodeSets: [], overlay: {}, routing: { mode: 'independent', config: { groups: [], rules: [], final: { kind: 'builtin', name: 'DIRECT' } } } });
if (profile.status !== 201) throw new Error(profile.text);
const app = createApp({ ...env, ruleRepos: env.repos, publicUrl: 'http://127.0.0.1:18836', webDir: resolve('../web/dist') });
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 18836 });
console.log(`隔离验收：http://127.0.0.1:18836；账号 reference-admin，密码 password-123；模板 ${published.json.item.id}；订阅 ${profile.json.item.id}`);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if ('closeIdleConnections' in server) server.closeIdleConnections();
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  await env.stop();
}
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void stop().catch(error => { console.error(error); process.exitCode = 1; }); });
