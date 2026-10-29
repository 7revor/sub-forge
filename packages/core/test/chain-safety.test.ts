import { describe, expect, it } from 'vitest';
import { renderMihomo, type RenderInput } from '../src/render/mihomo.ts';
import type { GroupSpec, Profile } from '../src/types.ts';

const base = (group: GroupSpec, output: 'provider' | 'inline' = 'provider'): RenderInput => ({
  profile: {
    id: 'p', name: 'P', nodeSets: [{ ref: { type: 'source', id: 's' }, output }],
    overlay: { extraGroups: [{ group }] },
    chains: [{ id: 'c', landing: { nodeSet: { type: 'source', id: 's' }, filter: '^落地$' }, via: { kind: 'group', groupId: 'g' } }],
    refPolicy: { default: 'wrap' },
  },
  nodeSets: { sources: { s: { id: 's', name: '源', urls: ['https://s.test/sub'], pipeline: [] } }, collections: {}, locals: {}, snapshots: { s: ['proxies:\n  - { name: 落地, type: socks5, server: landing.test, port: 1080 }\n  - { name: 前置, type: http, server: relay.test, port: 8080 }\n'] } },
  rules: { rulesets: {}, snapshots: {} },
  urls: { provider: (key, v) => `https://test/p/${key}?v=${v}`, ruleset: key => `https://test/r/${key}` },
});
const group = (patch: Partial<GroupSpec> = {}): GroupSpec => ({ id: 'g', name: '前置组', type: 'select', members: [{ kind: 'nodeset', ref: { type: 'source', id: 's' } }], filter: '^前置$', ...patch });

describe('代理链的失败保护与真实成员展开', () => {
  it.each(['reject', 'direct'] as const)('动态策略组始终声明为空时 %s', whenEmpty => {
    const r = renderMihomo(base(group({ filter: '^不存在$', whenEmpty })));
    expect(r.config['proxy-groups']).toEqual([expect.objectContaining({ 'empty-fallback': whenEmpty === 'reject' ? 'REJECT' : 'COMPATIBLE' })]);
  });

  it('同源前置过滤掉落地后不误报环', () => {
    expect(renderMihomo(base(group())).report.byCode('chain.cycle')).toEqual([]);
    expect(renderMihomo(base(group({ filter: undefined, excludeFilter: '^落地$' }))).report.byCode('chain.cycle')).toEqual([]);
    expect(renderMihomo(base(group({ filter: undefined, excludeType: 'socks5' }))).report.byCode('chain.cycle')).toEqual([]);
  });

  it.each([
    ['providers', 'provider'], ['proxies', 'inline'], ['all', 'provider'], ['all', 'inline'],
  ] as const)('include-all-%s 包含自身时检测出环（%s）', (scope, output) => {
    const r = renderMihomo(base(group({ filter: undefined, members: [{ kind: 'all', scope }] }), output));
    expect(r.report.byCode('chain.cycle')).toHaveLength(1);
  });

  it('include-all 的过滤同样参与环检测', () => {
    expect(renderMihomo(base(group({ members: [{ kind: 'all', scope: 'providers' }] }))).report.byCode('chain.cycle')).toEqual([]);
  });

  it('上游自带前置丢失时禁止发布', () => {
    const input = base(group());
    input.profile.chains = [];
    input.nodeSets.snapshots.s = ['proxies:\n  - { name: 落地, type: socks5, server: landing.test, port: 1080, dialer-proxy: 已消失 }'];
    expect(renderMihomo(input).report.byCode('ref.upstream-dialer-missing')).toEqual([expect.objectContaining({ level: 'error' })]);
  });

  it('复制到本地的节点参与前置环检测', () => {
    const input = base(group({ members: [{ kind: 'node', ref: { nodeSet: { type: 'source', id: 's' }, match: { exact: '落地' } } }] }));
    input.profile.refPolicy.default = 'copy';
    expect(renderMihomo(input).report.byCode('chain.cycle')).toHaveLength(1);
  });
});
