import type { RenderInput, RoutingConfig } from '../../src/index.ts';
export const direct = { kind: 'builtin' as const, name: 'DIRECT' as const };
export function iniFixture(): RenderInput {
  return {
    profile: { id: 'p', name: '多客户端', nodeSets: [{ ref: { type: 'local', id: 'nodes' }, output: 'provider' }], chains: [], refPolicy: { default: 'wrap' }, overlay: {}, routing: { mode: 'independent', config: {
      groups: [{ id: 'all', name: '代理', type: 'select', members: [{ kind: 'nodeset', ref: { type: 'local', id: 'nodes' } }] }],
      rules: [{ id: 'ua', matcher: { kind: 'rule', rule: { type: 'USER-AGENT', value: 'Example*' } }, target: { kind: 'group', groupId: 'all' } }], final: direct,
    } } },
    nodeSets: { sources: {}, collections: {}, locals: { nodes: { id: 'nodes', name: '节点集', proxies: [
      { name: '香港', type: 'trojan', server: 'hk.example.test', port: 443, password: 'example' },
      { name: '日本', type: 'hysteria2', server: 'jp.example.test', port: 443, password: 'hy2-example', down: '1 Gbps' },
    ] } }, snapshots: {} },
    rules: { rulesets: {}, snapshots: {} },
    base: { general: { loglevel: 'notify', ipv6: false, 'test-timeout': 5, 'dns-server': ['system', '1.1.1.1'] }, host: { 'local.example.test': '192.0.2.1' } },
    urls: { provider: key => 'https://sub.test/p/' + key, ruleset: key => 'https://sub.test/r/' + key + '?v=test&target=surge' },
  };
}
export function routing(f: RenderInput): RoutingConfig {
  if (f.profile.routing?.mode !== 'independent') throw new Error('测试需要独立分流');
  return f.profile.routing.config;
}
