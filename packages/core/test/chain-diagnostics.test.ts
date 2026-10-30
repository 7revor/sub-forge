import { describe, expect, it } from 'vitest';
import { renderMihomo, renderStash, type RenderInput } from '../src/render/mihomo.ts';
import type { ChainRule } from '../src/types.ts';
const ref = (id: string) => ({ type: 'local' as const, id });
const node = (id: string, name: string) => ({ kind: 'node' as const, ref: { nodeSet: ref(id), match: { exact: name }, fallback: 'error' as const } });
function fixture(): RenderInput {
  return {
    profile: { id: 'p', name: '诊断', nodeSets: ['landing', 'relay', 'other'].map(id => ({ ref: ref(id), output: 'provider' })), overlay: {}, refPolicy: { default: 'copy' }, chains: [{ id: 'c', landing: { nodeSet: ref('landing') }, via: { kind: 'node', ref: { nodeSet: ref('relay'), match: { regex: '香港' } } } }], routing: { mode: 'independent', config: { groups: [], rules: [], final: { kind: 'builtin', name: 'DIRECT' } } } },
    nodeSets: { sources: {}, collections: {}, snapshots: {}, locals: Object.fromEntries([['landing', ['落地 A', '落地 B']], ['relay', ['香港 1', '香港 2']], ['other', ['其他']]].map(([id, names]) => [id, { id, name: id, proxies: (names as string[]).map(name => ({ name, type: 'socks5', server: 'example.test', port: 1080 })) }])) },
    rules: { rulesets: {}, snapshots: {} }, urls: { provider: k => k, ruleset: k => k },
  };
}
describe('自动引用与代理链诊断', () => {
  it.each([renderMihomo, renderStash])('按客户端自动处理且返回实际前置与落地数量', render => {
    const f = fixture(), before = JSON.stringify(f);
    const r = render(f);
    expect(r.chainResolutions).toEqual([{ chainId: 'c', viaName: '香港 1', landingCount: 2, appliedCount: 2, issues: [] }]);
    expect(JSON.stringify(f)).toBe(before);
    if (render === renderMihomo) {
      expect(r.config.proxies).toEqual([]); expect(r.dependencies[0]?.strategy).toBe('wrap');
      f.profile.refPolicy.perRef = { [r.dependencies[0]!.refKey]: 'inline' };
      expect(render(f).config).toEqual(r.config);
    } else expect(r.config['proxy-providers']).toBeUndefined();
  });
  it('前置丢失、落地为空分别定位到对应链', () => {
    const f = fixture(); f.profile.chains[0]!.via = node('relay', '已删除');
    const missing = renderMihomo(f).chainResolutions[0]!;
    expect(missing.viaName).toBeUndefined(); expect(missing.issues.map(i => i.code)).toContain('ref.unresolved');
    f.profile.chains[0]!.landing.filter = '不存在';
    const empty = renderMihomo(f).chainResolutions[0]!;
    expect(empty.landingCount).toBe(0); expect(empty.issues.map(i => i.code)).toContain('chain.no-landing');
  });
  it('整集覆写只在被覆盖的局部链提示，生效数区分命中数', () => {
    const f = fixture(); f.profile.chains.push({ ...f.profile.chains[0]!, id: 'partial', landing: { nodeSet: ref('landing'), filter: '^落地 A$' } });
    const r = renderMihomo(f);
    expect(r.chainResolutions[0]!.issues).toEqual([]);
    expect(r.chainResolutions[1]).toMatchObject({ landingCount: 1, appliedCount: 0, issues: [expect.objectContaining({ code: 'chain.overridden' })] });
  });
  it('环及依赖此环的链全部标记，不误报无关链', () => {
    const f = fixture();
    const chain = (id: string, set: string, via: ChainRule['via']): ChainRule => ({ id, landing: { nodeSet: ref(set) }, via });
    f.profile.chains = [chain('a', 'landing', node('relay', '香港 1')), chain('b', 'relay', node('landing', '落地 A')), chain('affected', 'other', node('relay', '香港 1'))];
    f.profile.nodeSets.push({ ref: ref('safe'), output: 'inline' });
    f.nodeSets.locals.safe = { id: 'safe', name: '无关', proxies: [{ name: '安全', type: 'socks5', server: 'safe.test', port: 1080 }] };
    f.profile.chains.push(chain('safe', 'safe', { kind: 'builtin', name: 'DIRECT' }));
    const r = renderMihomo(f);
    for (const id of ['a', 'b', 'affected']) expect(r.chainResolutions.find(c => c.chainId === id)!.issues.some(i => i.code === 'chain.cycle')).toBe(true);
    expect(r.chainResolutions.find(c => c.chainId === 'safe')!.issues).toEqual([]);
  });
});
