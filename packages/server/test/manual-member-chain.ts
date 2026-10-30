// 内置浏览器隔离验收：虚构账号、内存数据库和固定上游，不读写用户数据。
import { serve } from '@hono/node-server';
import { resolve } from 'node:path';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/crypto.ts';
import { Store } from '../src/store.ts';
import { SnapshotService } from '../src/snapshots.ts';
import { RenderService } from '../src/render.ts';
const store = new Store(':memory:');
const user = store.createUser({ username: 'member-admin', passwordHash: await hashPassword('member-demo-2026'), role: 'admin' });
const direct = { kind: 'builtin' as const, name: 'DIRECT' as const };
const compact = { id: 'compact', name: '精简', version: 1, groups: [
  { id: 'science', name: '🚀 科学上网', type: 'fallback' as const, members: [] },
  { id: 'domestic', name: '🎯 国内网络', type: 'select' as const, members: [direct, { kind: 'group' as const, groupId: 'science' }] },
  { id: 'others', name: '🐟 其他网站', type: 'select' as const, display: { hidden: true }, members: [{ kind: 'group' as const, groupId: 'science' }, direct] },
], rules: [], final: { kind: 'group' as const, groupId: 'others' } };
const full = { ...compact, id: 'configured', name: '带完整参数', groups: compact.groups.map(g => g.id === 'science' ? { ...g, test: { url: 'https://example.test/ping', interval: 300, timeout: 5000, maxFailedTimes: 5, expectedStatus: '204', lazy: false } } : g) };
const allProviders = ['self', 'relay', 'other'].map(id => ({ ref: { type: 'local' as const, id }, output: 'provider' as const }));
store.importSeed({
  locals: [
    { id: 'self', name: '自建落地', proxies: [{ name: '🇺🇸 GCP [01]', type: 'socks5', server: 'gcp.example.test', port: 1080 }, { name: '🇸🇬 新加坡', type: 'socks5', server: 'sg.example.test', port: 1080 }] },
    { id: 'relay', name: '中转机场', proxies: [{ name: '🇭🇰 香港 IPLC', type: 'socks5', server: 'hk.example.test', port: 1080 }, { name: '🇯🇵 日本 IEPL', type: 'socks5', server: 'jp.example.test', port: 1080 }] },
    { id: 'other', name: '备用机场', proxies: [{ name: '🇭🇰 香港备用', type: 'socks5', server: 'hk2.example.test', port: 1080 }, { name: '🇯🇵 日本备用', type: 'socks5', server: 'jp2.example.test', port: 1080 }] },
  ],
  templates: [compact, full, { id: 'tpl', name: '日常分流模板', version: 1, groups: [{ id: 'select', name: '🚀 科学上网', type: 'select', members: [{ kind: 'builtin', name: 'DIRECT' }] }, { id: 'hk', name: '🇭🇰 香港', type: 'url-test', filter: '香港', members: [] }], rules: [], final: { kind: 'group', groupId: 'select' } }],
  profiles: [{ id: 'all-providers', name: '全部 Provider 场景', overlay: {}, nodeSets: allProviders, refPolicy: { default: 'wrap' }, chains: [], routing: { mode: 'bound', templateId: 'compact', groupAdditions: {} } }, { id: 'configured', name: '完整参数回显', overlay: {}, nodeSets: allProviders, refPolicy: { default: 'wrap' }, chains: [], routing: { mode: 'bound', templateId: 'configured', groupAdditions: {} } }, { id: 'empty', name: '空来源场景', overlay: {}, nodeSets: [], refPolicy: { default: 'wrap' }, chains: [], routing: { mode: 'independent', config: { groups: [], rules: [], final: direct } } }, { id: 'independent', name: '成员与代理链验收', overlay: {}, nodeSets: [{ ref: { type: 'local', id: 'self' }, output: 'inline' }, { ref: { type: 'local', id: 'relay' }, output: 'provider' }, { ref: { type: 'local', id: 'other' }, output: 'provider' }], refPolicy: { default: 'wrap' }, chains: [], routing: { mode: 'independent', config: {
    groups: [{ id: 'select', name: '🚀 科学上网', type: 'select', members: [{ kind: 'builtin', name: 'DIRECT' }] }, { id: 'hk', name: '🇭🇰 香港', type: 'url-test', filter: '香港', members: [] }], rules: [], final: { kind: 'group', groupId: 'select' },
  } } }, { id: 'bound', name: '模板绑定验收', overlay: {}, nodeSets: [{ ref: { type: 'local', id: 'self' }, output: 'inline' }, { ref: { type: 'local', id: 'relay' }, output: 'provider' }], refPolicy: { default: 'wrap' }, chains: [], routing: { mode: 'bound', templateId: 'tpl', groupAdditions: {} } }],
  tokens: [{ token: 'member-test-token', userId: user.id }],
}, user.id);
// 旧落地正则需保留原范围，不能因新编辑器只提供整集 / 单节点而静默扩大。
store.put('profile', { id: 'legacy-chain', name: '历史代理链兼容', overlay: {}, nodeSets: allProviders, refPolicy: { default: 'wrap' }, chains: [{ id: 'legacy', landing: { nodeSet: { type: 'local', id: 'self' }, filter: 'GCP', excludeFilter: '过期' }, via: { kind: 'node', ref: { nodeSet: { type: 'local', id: 'relay' }, match: { exact: '🇭🇰 香港 IPLC' }, fallback: 'error' } } }], routing: { mode: 'independent', config: { groups: [], rules: [], final: direct } } }, user.id);
// 自动引用与卡片诊断：正常、缺失、策略组成环各一条。
store.put('profile', { id: 'auto-chain', name: '代理链自动处理验收', overlay: {}, nodeSets: allProviders, refPolicy: { default: 'copy', perRef: { old: 'inline' } }, chains: [
  { id: 'good', landing: { nodeSet: { type: 'local', id: 'self' }, filter: '^🇺🇸 GCP \\[01\\]$' }, via: { kind: 'node', ref: { nodeSet: { type: 'local', id: 'other' }, match: { regex: '香港' } } } },
  { id: 'missing', landing: { nodeSet: { type: 'local', id: 'self' }, filter: '^🇸🇬 新加坡$' }, via: { kind: 'node', ref: { nodeSet: { type: 'local', id: 'other' }, match: { exact: '已删除的前置' } } } },
  { id: 'cycle', landing: { nodeSet: { type: 'local', id: 'relay' } }, via: { kind: 'group', groupId: 'loop' } },
], routing: { mode: 'independent', config: { groups: [{ id: 'loop', name: '循环前置组', type: 'select', members: [{ kind: 'nodeset', ref: { type: 'local', id: 'relay' } }] }], rules: [], final: direct } } }, user.id);
const snapshots = new SnapshotService(store, async url => { throw new Error(`验收禁止访问上游：${url}`); });
const publicUrl = 'http://member-chain.localhost:18952';
const renderer = new RenderService(store, snapshots, { publicUrl });
const app = createApp({ store, snapshots, renderer, publicUrl, webDir: resolve('../web/dist') });
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 18951 });
console.log(`隔离验收：${publicUrl}`);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if ('closeIdleConnections' in server) server.closeIdleConnections();
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  await snapshots.settled(); store.close();
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void stop().catch(error => { console.error(error); process.exitCode = 1; }); });
