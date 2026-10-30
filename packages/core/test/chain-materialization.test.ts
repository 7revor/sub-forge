import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { renderMihomo, renderStash, type RenderInput } from '../src/render/mihomo.ts';
import type { ChainRule } from '../src/types.ts';
const ref = { type: 'source' as const, id: 's' };
const direct = { kind: 'builtin' as const, name: 'DIRECT' as const };
const whole: ChainRule = { id: 'whole', landing: { nodeSet: ref }, via: direct };
const partial: ChainRule = { id: 'partial', landing: { nodeSet: ref, filter: '^落地$' }, via: { kind: 'builtin', name: 'REJECT' } };
function fixture(): RenderInput {
  return {
    profile: { id: 'p', name: '订阅', overlay: {}, nodeSets: [{ ref, output: 'provider' }], chains: structuredClone([whole]), refPolicy: { default: 'wrap' }, routing: { mode: 'independent', config: { groups: [{ id: 'g', name: '代理', type: 'select', members: [{ kind: 'nodeset', ref }] }], rules: [], final: { kind: 'group', groupId: 'g' } } } },
    nodeSets: { sources: { s: { id: 's', name: '来源', url: 'https://example.test', pipeline: [] } }, collections: {}, locals: {}, snapshots: { s: ['proxies:\n- { name: 落地, type: socks5, server: landing.test, port: 1080 }\n- { name: 前置, type: socks5, server: relay.test, port: 1080 }'] } },
    rules: { rulesets: {}, snapshots: {} }, urls: { provider: (k, v) => `https://sub.test/${k}?v=${v}`, ruleset: k => k },
  };
}
describe('订阅专属 Provider 服务端覆写', () => {
  it('整集前置写入每个节点，仍以 Provider 下发且不修改原始输入', () => {
    const f = fixture(); const before = JSON.stringify(f);
    const result = renderMihomo(f);
    expect(result.report.hasErrors).toBe(false);
    expect(result.config.proxies).toEqual([]);
    expect(result.config['proxy-providers']).toEqual({ 来源: expect.not.objectContaining({ override: expect.anything() }) });
    expect(parse(result.providers['source:s']!.yaml).proxies.map((p: any) => p['dialer-proxy'])).toEqual(['DIRECT', 'DIRECT']);
    expect(JSON.stringify(f)).toBe(before);
  });
  it.each([false, true])('整集覆写优先于部分规则，与排列无关（反向 %s）', reverse => {
    const f = fixture(); f.profile.chains = reverse ? [partial, whole] : [whole, partial];
    const m = renderMihomo(f), s = renderStash(f);
    expect(parse(m.providers['source:s']!.yaml).proxies.map((p: any) => p['dialer-proxy'])).toEqual(['DIRECT', 'DIRECT']);
    expect((s.config.proxies as any[]).map(p => p['dialer-proxy'])).toEqual(['DIRECT', 'DIRECT']);
    expect(m.report.byCode('chain.overridden')).toHaveLength(1);
    expect(s.report.hasErrors).toBe(false);
  });
  it('不解析已被覆写的失效上游前置', () => {
    const f = fixture(); f.nodeSets.snapshots.s = ['proxies:\n- { name: 落地, type: socks5, server: node.test, port: 1080, dialer-proxy: 已删除 }'];
    expect(renderMihomo(f).report.hasErrors).toBe(false);
    f.profile.chains = [];
    expect(renderMihomo(f).report.byCode('ref.upstream-dialer-missing')).toHaveLength(1);
  });
  it('冲突规则阻止发布，不按数组顺序静默取最后一条', () => {
    const f = fixture(); f.profile.chains = [partial, { ...partial, id: 'other', via: direct }];
    expect(renderMihomo(f).report.byCode('chain.conflict')).toHaveLength(1);
    f.profile.chains = [whole, { ...whole, id: 'other', via: partial.via }];
    expect(renderMihomo(f).report.hasErrors).toBe(true);
  });
  it('整集引用同源前置节点会成环，部分落地排除前置则可用', () => {
    const f = fixture(); f.profile.chains[0] = { ...whole, landing: { ...whole.landing }, via: { kind: 'node', ref: { nodeSet: ref, match: { exact: '前置' } } } };
    expect(renderMihomo(f).report.byCode('chain.cycle')).toHaveLength(1);
    f.profile.chains[0]!.landing.filter = '^落地$';
    const result = renderMihomo(f);
    expect(result.report.hasErrors).toBe(false);
    expect(result.config['proxy-groups']).toContainEqual(expect.objectContaining({ filter: '^前置$', hidden: true, 'empty-fallback': 'REJECT' }));
  });
  it('复制到 Inline 的节点也继承整集覆写，而原始来源不变', () => {
    const f = fixture(); f.profile.refPolicy.default = 'copy';
    if (f.profile.routing?.mode !== 'independent') throw new Error('测试配置错误');
    f.profile.routing.config.groups[0]!.members.push({ kind: 'node', ref: { nodeSet: ref, match: { exact: '落地' } } });
    expect(renderMihomo(f).config.proxies).toEqual([expect.objectContaining({ name: '落地', 'dialer-proxy': 'DIRECT' })]);
  });
});
