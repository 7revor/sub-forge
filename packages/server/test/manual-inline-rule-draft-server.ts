// 临时隔离验收入口：确定性仓库索引、内存数据库、虚构规则与账户。
import { serve } from '@hono/node-server';
import { resolve } from 'node:path';
import { remoteRuleMatcher } from '@sub-forge/core';
import { createApp } from '../src/app.ts';
import { setupRuleReferences } from './rule-reference-fixture.ts';

const env = await setupRuleReferences();
for (let index = 0; index < 35; index++) env.store.put('ruleset', {
  id: `sample-${index}`, name: `分页验收 ${String(index).padStart(2, '0')}`,
  sources: [{ id: 'local', kind: 'local', format: 'auto', content: `DOMAIN,sample-${index}.example.test` }],
}, env.user.id);
const direct = { kind: 'builtin' as const, name: 'DIRECT' as const };
const template = { id: 'inline-hint', name: '规则布局验收', version: 1, groups: [
  { id: 'direct', name: '🎯 国内网络', type: 'select' as const, members: [direct] },
  { id: 'proxy', name: '🚀 科学上网', type: 'select' as const, members: [direct] },
], rules: [
  { id: 'google', matcher: remoteRuleMatcher('https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Surge/Google/Google.list'), target: { kind: 'group' as const, groupId: 'direct' } },
  { id: 'openai', matcher: remoteRuleMatcher('https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Surge/OpenAI/OpenAI.list'), target: { kind: 'group' as const, groupId: 'proxy' } },
  { id: 'static', matcher: { kind: 'rule' as const, rule: { type: 'DOMAIN-SUFFIX' as const, value: 'example.test' } }, target: direct },
], final: direct };
env.store.putTemplateVersion(template);
env.store.put('profile', { id: 'inline-profile', name: '独立规则验收', nodeSets: [], overlay: {}, chains: [], refPolicy: { default: 'wrap' }, routing: { mode: 'independent', config: template } }, env.user.id);
const publicUrl = 'http://127.0.0.1:5223';
const app = createApp({ ...env, ruleRepos: env.repos, publicUrl, webDir: resolve('../web/dist') });
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 5223 });
console.log(`隔离验收：${publicUrl}；账号 reference-admin，密码 password-123`);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if ('closeIdleConnections' in server) server.closeIdleConnections();
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  await env.stop();
}
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void stop().catch(error => { console.error(error); process.exitCode = 1; }); });
