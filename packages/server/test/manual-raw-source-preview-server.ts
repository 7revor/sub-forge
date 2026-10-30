// 源文件预览验收：隔离内存数据，索引与转换正文均为固定样本，仅监听回环地址。
import { serve } from '@hono/node-server';
import { resolve } from 'node:path';
import { remoteRuleMatcher, type Matcher } from '@sub-forge/core';
import { createApp } from '../src/app.ts';
import { RenderService } from '../src/render.ts';
import { setupRuleReferences } from './rule-reference-fixture.ts';

const env = await setupRuleReferences();
env.setPaths(['rule/Surge/Google/Google.list', 'rule/Surge/OpenAI/OpenAI.list',
  ...Array.from({ length: 33 }, (_, i) => `rule/Surge/Sample/Sample-${String(i).padStart(2, '0')}.list`)]);
await env.repos.refresh('blackmatrix7');
const repository: Matcher = await env.resolve();
if (repository.kind !== 'ruleset' || !repository.repository?.sources[0]) throw new Error('验收仓库来源缺失');
const linked = repository.repository.sources[0];
const direct = { kind: 'builtin' as const, name: 'DIRECT' as const };
const local = { kind: 'local' as const, content: '# 本地原文\nDOMAIN,local.example.test' };
const remote = remoteRuleMatcher('https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Surge/OpenAI/OpenAI.list');
env.store.put('ruleset', { id: 'preview-enhanced', name: '预览增强集合', sources: [
  { ...linked, id: 'repo' },
  { id: 'remote', kind: 'remote', format: 'auto', url: remote.remote!.url },
  { id: 'local', kind: 'local', format: 'auto', content: local.content },
], overrides: [{ override: { when: { client: 'surge' }, action: { append: [{ type: 'DOMAIN', value: 'enhanced.example.test' }] } } }] }, env.user.id);
const rules = [repository, remote, { kind: 'ruleset' as const, id: 'preview-enhanced' }, local]
  .map((matcher, i) => ({ id: `preview-${i}`, matcher, target: direct }));
const config = { groups: [], rules, final: direct };
env.store.putTemplateVersion({ id: 'preview-template', name: '源文件预览模板', version: 1, ...config });
for (const bound of [false, true]) env.store.put('profile', {
  id: bound ? 'preview-bound' : 'preview-profile', name: bound ? '跟随模板预览' : '独立订阅预览', nodeSets: [], overlay: {}, chains: [], refPolicy: { default: 'wrap' },
  routing: bound ? { mode: 'bound', templateId: 'preview-template', groupAdditions: {} } : { mode: 'independent', config },
}, env.user.id);
const publicUrl = 'http://127.0.0.1:5248';
const renderer = new RenderService(env.store, env.snapshots, { publicUrl });
const app = createApp({ ...env, renderer, ruleRepos: env.repos, publicUrl, webDir: resolve('../web/dist') });
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 5248 });
console.log(`源文件预览验收：${publicUrl}；账号 reference-admin，密码 password-123`);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  env.store.closeEvents();
  if ('closeAllConnections' in server) server.closeAllConnections();
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  await env.stop();
}
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void stop().catch(error => { console.error(error); process.exitCode = 1; }); });
