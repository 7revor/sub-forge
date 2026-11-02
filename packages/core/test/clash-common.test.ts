import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { parseContent, renderClash, type RenderInput } from '../src/index.ts';

const ref = (id: string) => ({ type: 'local' as const, id });
const proxy = (name: string) => ({ name, type: 'ss', server: 'node.example.test', port: 443, cipher: 'aes-128-gcm', password: 'fixture' });
function fixture(front: 'provider' | 'inline', landing: 'provider' | 'inline'): RenderInput {
  return {
    profile: { id: 'common', name: '公共生成', nodeSets: [{ ref: ref('front'), output: front }, { ref: ref('landing'), output: landing }],
      chains: [{ id: 'chain', landing: { nodeSet: ref('landing') }, via: { kind: 'group', groupId: 'upstream' } }],
      routing: { mode: 'independent', config: {
        groups: [{ id: 'upstream', name: 'upstream-select', type: 'select', members: [{ kind: 'nodeset', ref: ref('front') }, { kind: 'builtin', name: 'DIRECT' }] }],
        rules: [], final: { kind: 'group', groupId: 'upstream' },
      } },
    },
    nodeSets: { sources: {}, collections: {}, snapshots: {}, locals: {
      front: { id: 'front', name: '前置来源', proxies: [proxy('ss1'), proxy('ss2')] },
      landing: { id: 'landing', name: '落地来源', proxies: [{ name: 'vless-hk', type: 'vless', server: 'hk.example.test', port: 443, uuid: 'fixture', tls: true }] },
    } },
    rules: { rulesets: {}, snapshots: {} }, urls: { provider: key => `https://example.test/nodes/${key}`, ruleset: key => key },
  };
}
const nodes = (result: ReturnType<typeof renderClash>, output: 'provider' | 'inline') => output === 'provider'
  ? parse(result.providers['local:landing']!.yaml).proxies as Record<string, unknown>[]
  : (result.config.proxies as Record<string, unknown>[]).filter(node => node.name === 'vless-hk');

describe('Clash/Mihomo 公共生成与 Stash 最小差异', () => {
  for (const front of ['provider', 'inline'] as const) for (const landing of ['provider', 'inline'] as const) {
    it(`策略组前置：${front} → ${landing}，两端保留相同 dialer-proxy`, () => {
      const input = fixture(front, landing), before = JSON.stringify(input);
      const mihomo = renderClash(input), stash = renderClash(input, 'stash');
      expect(stash.report.items).toEqual(mihomo.report.items);
      expect(stash.report.hasErrors).toBe(false);
      expect(nodes(stash, landing)).toEqual(nodes(mihomo, landing));
      expect(nodes(stash, landing)[0]!['dialer-proxy']).toBe('upstream-select');
      expect(stash.chainResolutions).toEqual(mihomo.chainResolutions);
      expect(JSON.stringify(input)).toBe(before);
    });
    it(`单节点前置：${front} → ${landing}，两端复用相同隐藏组和依赖`, () => {
      const input = fixture(front, landing);
      input.profile.chains[0]!.via = { kind: 'node', ref: { nodeSet: ref('front'), match: { exact: 'ss1' } } };
      const mihomo = renderClash(input), stash = renderClash(input, 'stash');
      expect(stash.report.items).toEqual(mihomo.report.items);
      expect(stash.dependencies).toEqual(mihomo.dependencies);
      expect(nodes(stash, landing)).toEqual(nodes(mihomo, landing));
      expect(nodes(stash, landing)[0]!['dialer-proxy']).toBe(front === 'inline' ? 'ss1' : mihomo.dependencies[0]!.output);
    });
  }
  it('普通节点与 provider 声明共用公共结构', () => {
    const input = fixture('provider', 'inline'); input.profile.chains = [];
    const mihomo = renderClash(input), stash = renderClash(input, 'stash');
    expect(stash.config.proxies).toEqual(mihomo.config.proxies);
    expect(stash.config['proxy-providers']).toEqual(mihomo.config['proxy-providers']);
    expect(stash.providers['local:front']!.yaml).toBe(mihomo.providers['local:front']!.yaml);
    const groups = structuredClone(mihomo.config['proxy-groups']) as Record<string, unknown>[];
    for (const group of groups) delete group['empty-fallback'];
    expect(stash.config['proxy-groups']).toEqual(groups);
  });
  it('扩展 include-all 仍经过托管筛选和空集合保护', () => {
    const input = fixture('provider', 'inline'); input.profile.chains = [];
    if (input.profile.routing?.mode !== 'independent') throw new Error('测试需要独立分流');
    const group = input.profile.routing.config.groups[0]!;
    group.members = []; group.extra = { 'include-all': true, filter: '^ss1$' };
    const out = renderClash(input, 'stash');
    expect(out.report.hasErrors).toBe(false);
    const selected = (out.config['proxy-groups'] as Record<string, unknown>[])[0]!;
    expect(selected).not.toHaveProperty('include-all');
    expect(selected.proxies ?? []).toEqual([]);
    const subset = Object.entries(out.providers).find(([key]) => key.startsWith('view:'))![1];
    expect(parse(subset.yaml).proxies.map((node: any) => node.name)).toEqual(['ss1']);
    group.extra.filter = '不存在';
    expect(renderClash(input, 'stash').config['proxy-groups']).toMatchObject([{ proxies: ['REJECT'] }]);
  });
  it('扩展测速字段按公共覆盖顺序换算，零值保留', () => {
    const input = fixture('inline', 'inline'); input.profile.chains = [];
    if (input.profile.routing?.mode !== 'independent') throw new Error('测试需要独立分流');
    const group = input.profile.routing.config.groups[0]!;
    group.type = 'url-test'; group.test = { url: 'https://example.test/first', timeout: 3000 };
    group.extra = { url: 'https://example.test/override', timeout: 0 };
    expect(renderClash(input, 'stash').config.proxies).toMatchObject([
      { 'benchmark-url': 'https://example.test/override', 'benchmark-timeout': 0 },
      { 'benchmark-timeout': 0 }, {},
    ]);
  });
  it('用户策略组和隐藏组均不能绕过公共循环检查', () => {
    const input = fixture('provider', 'provider');
    input.profile.chains[0]!.landing.nodeSet = ref('front');
    for (const client of ['mihomo', 'stash'] as const) expect(renderClash(input, client).report.items.some(r => r.level === 'error' && r.code.startsWith('chain.'))).toBe(true);
    input.profile.chains[0]!.via = { kind: 'node', ref: { nodeSet: ref('front'), match: { exact: 'ss1' } } };
    for (const client of ['mihomo', 'stash'] as const) expect(renderClash(input, client).report.items.some(r => r.level === 'error' && r.code.startsWith('chain.'))).toBe(true);
  });
  it('Stash YAML 节点导入后通过公共别名归一化输出到两个客户端', () => {
    const input = fixture('provider', 'inline'); input.profile.chains = [];
    const imported = parseContent('proxies:\n  - name: hy2\n    type: hysteria2\n    server: node.example.test\n    port: 443\n    auth: fixture\n    up-speed: 100\n    down-speed: 200\n', ref('landing'));
    expect(imported.failures).toEqual([]);
    input.nodeSets.locals.landing!.proxies = imported.proxies;
    expect(renderClash(input).config.proxies).toMatchObject([{ name: 'hy2', password: 'fixture', up: 100, down: 200 }]);
    const stash = renderClash(input, 'stash');
    expect(stash.config.proxies).toMatchObject([{ name: 'hy2', auth: 'fixture', 'up-speed': 100, 'down-speed': 200 }]);
    expect(stash.report.hasErrors).toBe(false);
  });
  it.each(['inline', 'provider'] as const)('Stash 保留 %s 节点的 block-quic off', output => {
    const input = fixture(output, output); input.profile.chains = [];
    input.nodeSets.locals.landing!.proxies[0]!['block-quic'] = 'off';
    const stash = renderClash(input, 'stash');
    expect(nodes(stash, output)[0]!['block-quic']).toBe('off');
    expect(stash.report.hasErrors).toBe(false);
  });
  it('别名冲突明确报告，不能静默覆盖认证和带宽', () => {
    const input = fixture('inline', 'inline'); input.profile.chains = [];
    input.nodeSets.locals.landing!.proxies = [{ ...proxy('hy2'), type: 'hysteria2', auth: 'conflict', up: '1 Gbps', 'up-speed': 100 }];
    for (const client of ['mihomo', 'stash'] as const) {
      const out = renderClash(input, client);
      expect(out.report.byCode('proxy.auth-conflict')).toHaveLength(1);
      expect(out.report.byCode('proxy.bandwidth-conflict')).toHaveLength(1);
    }
  });
});
