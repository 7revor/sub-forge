// 卡片与按需匹配隔离验收：仅内存数据、模拟索引与虚构上游，关闭时释放所有资源。
import { serve } from '@hono/node-server';
import { resolve } from 'node:path';
import { remoteRuleMatcher, type GroupSpec } from '@sub-forge/core';
import { createApp } from '../src/app.ts';
import { setupRuleReferences } from './rule-reference-fixture.ts';
const env = await setupRuleReferences();
const direct = { kind: 'builtin' as const, name: 'DIRECT' as const };
const url = 'https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Surge/Google/Google.list';
const linked = (await env.resolve()).repository.sources[0];
const groups: GroupSpec[] = process.argv.includes('--layout') ? [
  { id: 'select', name: '🚀 节点选择', type: 'select', members: [direct, { kind: 'builtin', name: 'REJECT' }] },
  { id: 'long', name: '较长的策略组名称用于检查卡片截断与操作按钮', type: 'url-test', members: [direct], display: { hidden: true } },
] : [];
const template = { id: 'cards-template', name: '统一规则卡片验收', version: 1, groups, rules: [
  { id: 'remote', matcher: remoteRuleMatcher(url), target: direct },
  { id: 'local', matcher: { kind: 'local' as const, content: '# 本地示例\nDOMAIN,a.example.test\nIP-CIDR,198.51.100.0/24,no-resolve' }, target: direct },
], final: direct };
env.store.putTemplateVersion(template);
env.store.put('ruleset', { id: 'cards-rules', name: '统一来源卡片验收', sources: [
  { ...linked, id: 'linked' }, { id: 'remote', kind: 'remote', format: 'auto', url },
  { id: 'local', kind: 'local', format: 'auto', content: 'DOMAIN,a.example.test\nDOMAIN,b.example.test' },
]}, env.user.id);
for (const bound of [false, true]) env.store.put('profile', {
  id: bound ? 'cards-bound' : 'cards-profile', name: bound ? '绑定规则验收' : '独立规则验收', nodeSets: [], overlay: {}, chains: [], refPolicy: { default: 'wrap' },
  routing: bound ? { mode: 'bound', templateId: template.id, groupAdditions: {}, prependRules: [{ ...template.rules[1]!, id: 'prepend' }] } : { mode: 'independent', config: { groups: template.groups, rules: template.rules, final: template.final } },
}, env.user.id);
// 可选图标验收数据：覆盖组合成员、处理链、订阅来源/链/链接等固定宽度按钮。
if (process.argv.includes('--icons')) {
  const nodeSet = { type: 'local' as const, id: 'icon-nodes' };
  env.store.importSeed({
    locals: [{ id: nodeSet.id, name: '图标验收节点', proxies: [{ name: '演示节点', type: 'socks5', server: 'node.example.test', port: 1080 }] }],
    collections: [{ id: 'icon-collection', name: '图标验收组合', members: [{ ref: nodeSet }], pipeline: [{ op: 'rename.regex', rules: [{ pattern: '演示', replace: '测试' }] }] }],
    tokens: [{ token: 'icon-audit-demo-token', userId: env.user.id }],
  }, env.user.id);
  const profile = env.store.get('profile', 'cards-profile')!;
  env.store.put('profile', { ...profile, nodeSets: [{ ref: nodeSet, output: 'inline' }], chains: [{ id: 'icon-chain', landing: { nodeSet }, via: direct }] }, env.user.id);
}
const publicUrl = 'http://127.0.0.1:5237';
const app = createApp({ ...env, ruleRepos: env.repos, publicUrl, webDir: resolve('../web/dist') });
let checks = 0;
const server = serve({ fetch: async request => {
  if (new URL(request.url).pathname === '/api/rule-options/match-urls') {
    console.log(`仓库关联检测 #${++checks}：${JSON.stringify(await request.clone().json())}`);
  }
  return app.fetch(request);
}, hostname: '127.0.0.1', port: 5237 });
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
