// 渲染测试共用的场景数据（单元测试与 mihomo -t 校验共用）
import { renderMihomo, type RenderInput } from '../../src/render/mihomo.ts';
import type { NodeSetInputs } from '../../src/nodeset/resolve.ts';
import type { Profile, Source, Template } from '../../src/types.ts';

export const trojan = (name: string, host: string) => `trojan://pw@${host}:443#${encodeURIComponent(name)}`;
export const src = (id: string, name: string): Source => ({ id, name, urls: [`https://${id.toLowerCase()}.example.com/sub`], pipeline: [] });

export const NODESETS: NodeSetInputs = {
  sources: { L: src('L', '落地'), T: src('T', '中转'), S: src('S', '家宽'), A: src('A', '机场 A') },
  collections: {},
  locals: {
    self: { id: 'self', name: '自建', proxies: [{ name: '自建 SG-01', type: 'trojan', server: 'sg', port: 443, password: 'p' }] },
  },
  snapshots: {
    L: [[trojan('L-01', 'l1'), trojan('L-02', 'l2'), trojan('L-JP', 'l3')].join('\n')],
    T: [[trojan('🇭🇰 IPLC-01', 't1'), trojan('🇭🇰 IPLC-02', 't2')].join('\n')],
    S: [trojan('🇺🇸 Home-Broadband', 's1')],
    A: [[trojan('🇭🇰 HK-01', 'a1'), trojan('🇯🇵 JP-01', 'a2')].join('\n')],
  },
};

export const TEMPLATE: Template = {
  id: 'std', version: 14,
  groups: [
    { id: 'sel', name: '🚀 节点选择', type: 'select', members: [{ kind: 'group', groupId: 'hk' }, { kind: 'builtin', name: 'DIRECT' }] },
    { id: 'hk', name: '🇭🇰 香港', type: 'url-test', members: [], test: { url: 'https://www.gstatic.com/generate_204', interval: 300, tolerance: 50 } },
    { id: 'ai', name: '🤖 AI 服务', type: 'select', members: [] },
    { id: 'media', name: '📺 国内媒体', type: 'select', members: [], whenEmpty: 'direct' },
  ],
  rules: [
    { id: 'r-fin', matcher: { kind: 'bundle', id: 'fin' }, target: { kind: 'group', groupId: 'sel' } },
    { id: 'r-ai', matcher: { kind: 'ruleset', id: 'ai' }, target: { kind: 'group', groupId: 'ai' } },
    { id: 'r-wx', matcher: { kind: 'rule', rule: { type: 'PROCESS', kind: 'path', mode: 'wildcard', value: '/Applications/*/WeChat.app/*' } }, target: { kind: 'builtin', name: 'DIRECT' } },
    { id: 'r-cn', matcher: { kind: 'rule', rule: { type: 'GEOIP', value: 'CN' } }, target: { kind: 'builtin', name: 'DIRECT' }, options: { noResolve: true } },
  ],
  final: { kind: 'group', groupId: 'sel' },
};

export const RULES: RenderInput['rules'] = {
  rulesets: {
    paypal: { id: 'paypal', name: 'PayPal', kind: 'local', format: 'auto', content: 'DOMAIN-SUFFIX,paypal.com\nDOMAIN-KEYWORD,paypal\nIP-CIDR,64.4.240.0/21' },
    ai: { id: 'ai', name: 'AI', kind: 'local', format: 'auto', content: '.openai.com\n.anthropic.com' },
    broker: { id: 'broker', name: '券商', kind: 'remote', format: 'mrs', behavior: 'ipcidr', url: 'https://example.com/broker.mrs' },
  },
  bundles: { fin: { id: 'fin', name: '金融服务', noResolve: true, items: [{ kind: 'ruleset', id: 'paypal' }, { kind: 'ruleset', id: 'broker' }] } },
  snapshots: {},
};

export const urls: RenderInput['urls'] = {
  provider: (key, v) => `https://sub.example.com/p/TOKEN/${encodeURIComponent(key)}?v=${v}`,
  ruleset: (key) => `https://sub.example.com/r/TOKEN/${key}`,
};

export const profile = (p: Partial<Profile>): Profile => ({
  id: 'p', name: 'P', nodeSets: [], overlay: {}, chains: [], refPolicy: { default: 'wrap' }, ...p,
});
export const render = (p: Partial<Profile>, extra: Partial<RenderInput> = {}) =>
  renderMihomo({ profile: profile(p), template: TEMPLATE, nodeSets: NODESETS, rules: RULES, urls, ...extra });
