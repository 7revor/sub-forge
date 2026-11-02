import { describe, expect, it } from 'vitest';
import { renderMihomo, sourceKey, type RenderInput } from '../src/index.ts';

const input = (snapshots: Record<string, string>, deferred: boolean): RenderInput => ({
  profile: { id: 'p', name: '订阅', nodeSets: [], chains: [], routing: { mode: 'independent', config: {
    groups: [], rules: [{ id: 'r', matcher: { kind: 'ruleset', id: 'rs' }, target: { kind: 'builtin', name: 'DIRECT' } }], final: { kind: 'builtin', name: 'DIRECT' },
  } } },
  nodeSets: { sources: {}, locals: {}, collections: {}, snapshots: {} },
  rules: { rulesets: { rs: { id: 'rs', name: '规则', sources: [{ id: 's', kind: 'remote', url: 'https://rules.test/a.list', format: 'auto' }] } }, snapshots },
  urls: { provider: (key: string) => key, ruleset: (key: string) => `https://sub.test/${key}` },
  deferRuleBody: () => deferred,
});

describe('主配置按需生成规则正文', () => {
  it('延后时只写 provider 地址，不产出正文', () => {
    const out = renderMihomo(input({ [sourceKey('rs', 's')]: 'DOMAIN,a.test' }, true));
    expect(out.rulesets).toEqual({});
    expect(out.config['rule-providers']).toMatchObject({ 规则: { type: 'http', format: 'text', behavior: 'classical', url: 'https://sub.test/rs_rs_classical.list' } });
    expect(out.config.rules).toEqual(['RULE-SET,规则,DIRECT', 'MATCH,DIRECT']);
  });

  it('延后与完整生成的主配置一致', () => {
    const snapshots = { [sourceKey('rs', 's')]: 'DOMAIN,a.test' };
    expect(renderMihomo(input(snapshots, true)).yaml).toBe(renderMihomo(input(snapshots, false)).yaml);
  });

  it('来源从未拉取成功时仍报错', () => {
    expect(renderMihomo(input({}, true)).report.items).toContainEqual(expect.objectContaining({ level: 'error', code: 'ruleset.no-snapshot' }));
  });
});
