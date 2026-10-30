import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { renderMihomo, renderStash, type RenderInput } from '../src/render/mihomo.ts';
import type { ChainNodeSet } from '../src/types.ts';
const ref = (id: string) => ({ type: 'local' as const, id });
const all = (id: 'provider' | 'inline'): ChainNodeSet => ({ type: 'all', id });
function fixture(output: 'provider' | 'inline'): RenderInput {
  return {
    profile: { id: 'all', name: '全部来源', nodeSets: ['a', 'b'].map(id => ({ ref: ref(id), output })), chains: [{ id: 'c', landing: { nodeSet: all(output), filter: '^落地' }, via: { kind: 'node', ref: { nodeSet: all(output), match: { regex: '^前置' } } } }], overlay: {}, refPolicy: { default: 'wrap' }, routing: { mode: 'independent', config: { groups: [], rules: [], final: { kind: 'builtin', name: 'DIRECT' } } } },
    nodeSets: { sources: {}, collections: {}, snapshots: {}, locals: Object.fromEntries(['a', 'b'].map(id => [id, { id, name: id, proxies: [`前置-${id}`, `落地-${id}`].map(name => ({ name, type: 'socks5', server: `${id}.example.test`, port: 1080 })) }])) },
    rules: { rulesets: {}, snapshots: {} }, urls: { provider: k => k, ruleset: k => k },
  };
}

describe('代理链全部来源', () => {
  for (const output of ['provider', 'inline'] as const) for (const [client, render] of [['Mihomo', renderMihomo], ['Stash', renderStash]] as const) {
    it(`${client} ${output}：汇总多个来源、采用首个匹配、自动包含后续来源`, () => {
      const f = fixture(output), before = JSON.stringify(f);
      const initial = render(f);
      expect(initial.report.hasErrors).toBe(false);
      expect(initial.chainResolutions).toEqual([{ chainId: 'c', viaName: '前置-a', landingCount: 2, appliedCount: 2, issues: [] }]);
      const nodes = (client === 'Mihomo' && output === 'provider'
        ? Object.values(initial.providers).flatMap(provider => parse(provider.yaml).proxies)
        : initial.config.proxies) as Record<string, unknown>[];
      const dialer = client === 'Mihomo' && output === 'provider' ? initial.dependencies[0]!.output : '前置-a';
      expect(nodes.filter(node => String(node.name).startsWith('落地')).map(node => node['dialer-proxy'])).toEqual([dialer, dialer]);
      expect(nodes.filter(node => String(node.name).startsWith('前置')).every(node => node['dialer-proxy'] === undefined)).toBe(true);
      expect(JSON.stringify(f)).toBe(before);
      f.profile.nodeSets.push({ ref: ref('new'), output });
      f.nodeSets.locals.new = { id: 'new', name: '新增', proxies: [{ name: '落地-新增', type: 'socks5', server: 'new.example.test', port: 1080 }] };
      expect(render(f).chainResolutions[0]).toMatchObject({ landingCount: 3, appliedCount: 3 });
      f.profile.nodeSets = f.profile.nodeSets.filter(s => s.ref.id !== 'a');
      expect(render(f).chainResolutions[0]).toMatchObject({ viaName: '前置-b', landingCount: 2, appliedCount: 2 });
    });
  }
  it.each([renderMihomo, renderStash])('只包含用户指定的输出类型，空匹配来源不产生误报', render => {
    const f = fixture('provider');
    f.profile.nodeSets[1]!.output = 'inline';
    f.profile.chains[0]!.landing.nodeSet = all('inline');
    const result = render(f);
    expect(result.report.hasErrors).toBe(false);
    expect(result.chainResolutions[0]).toMatchObject({ viaName: '前置-a', landingCount: 1, appliedCount: 1, issues: [] });
    f.profile.chains[0]!.landing.nodeSet = all('provider');
    f.profile.chains[0]!.landing.filter = '^落地-b$';
    expect(render(f).chainResolutions[0]).toMatchObject({ landingCount: 0, appliedCount: 0, issues: [expect.objectContaining({ code: 'chain.no-landing' })] });
  });
  it('默认全范围不能绕过循环检查', () => {
    const f = fixture('provider');
    f.profile.chains[0]!.landing.filter = undefined;
    expect(renderMihomo(f).report.byCode('chain.cycle').length).toBeGreaterThan(0);
  });
});
