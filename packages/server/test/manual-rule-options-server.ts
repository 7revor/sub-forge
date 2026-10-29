// 平铺选择器隔离验收：模拟 Git 目录、虚构正文和内存数据，不连接生产数据库。
import { serve } from '@hono/node-server';
import { resolve } from 'node:path';
import { createApp } from '../src/app.ts';
import { setupRuleReferences } from './rule-reference-fixture.ts';
const env = await setupRuleReferences();
env.setPaths([...Array.from({ length: 40 }, (_, i) => `rule/Clash/Many/file-${String(i).padStart(2, '0')}.list`), 'root.list', 'rule/Clash/China/China.list', 'rule/Clash/China/China_Domain.list', 'rule/Surge/China/China.list', 'rule/Clash/Cloud/Dropbox/Dropbox.txt', 'rule/Clash/China/README.md', 'rule/Clash/YamlOnly/file.yaml', 'rule/Clash/China/ignored.mrs']);
env.setFileBody('rule/Clash/China/China.list', '# China 原始规则示例\n\nDOMAIN,china.example.test\nIP-CIDR,198.51.100.0/24\n');
env.setFileBody('rule/Clash/China/China_Domain.list', '.domain.example.test\n');
env.setFileBody('rule/Surge/China/China.list', '# Surge 文件示例\nDOMAIN,surge.example.test\n');
env.setFileBody('root.list', '# 根目录文件\nDOMAIN,root.example.test\n');
await env.repos.refresh('blackmatrix7');
const custom = await env.repos.addCustom({ url: 'https://github.com/example/catalog-fixture', name: '根目录示例', ref: 'master' });
await env.repos.refresh(custom);
const published = await env.admin.post('/api/templates/new/publish', { name: '平铺模板', groups: [], rules: [], final: { kind: 'builtin', name: 'DIRECT' } });
if (published.status !== 201) throw new Error(published.text);
const profile = await env.admin.post('/api/profiles', { name: '平铺订阅', nodeSets: [], overlay: {}, routing: { mode: 'independent', config: { groups: [], rules: [], final: { kind: 'builtin', name: 'DIRECT' } } } });
if (profile.status !== 201) throw new Error(profile.text);
const app = createApp({ ...env, ruleRepos: env.repos, publicUrl: 'http://localhost:18837', webDir: resolve('../web/dist') });
const server = serve({ fetch: request => { const url = new URL(request.url); if (url.pathname.startsWith('/api/rule-options/')) console.log(url.pathname + url.search); return app.fetch(request); }, hostname: '127.0.0.1', port: 18837 });
console.log(`隔离验收：http://localhost:18837；账号 reference-admin，密码 password-123；模板 ${published.json.item.id}；订阅 ${profile.json.item.id}`);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if ('closeIdleConnections' in server) server.closeIdleConnections();
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  await env.stop();
}
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void stop().catch(error => { console.error(error); process.exitCode = 1; }); });
