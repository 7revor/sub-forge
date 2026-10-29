import { describe, expect, it } from 'vitest';
import { convertRuleDocuments, prepareRuleDocument, type RuleConversion } from '../src/rules/convert.ts';
import type { ClientCtx } from '../src/rules/client.ts';
import type { RuleSet } from '../src/types.ts';

const targets: ClientCtx[] = [{ client: 'mihomo' }, { client: 'mihomo', platform: 'android' }, { client: 'surge', platform: 'macos' }, { client: 'surge', platform: 'ios' }];
const source = (content: string) => ({ id: 'a', kind: 'local' as const, format: 'auto' as const, content });
function convert(rs: RuleSet, ctx: ClientCtx, sourceId?: string) {
  return convertRuleDocuments(rs, new Map(rs.sources.map(s => [s.id, prepareRuleDocument(s.content ?? '', s)])), ctx, { sourceId });
}
const active = (r: RuleConversion) => r.lines.filter(l => l.trim() && !l.trimStart().startsWith('#'));

describe('保留行位的通用规则转换', () => {
  it('四个客户端保留原注释、空行、未解析、重复和不兼容规则的位置', () => {
    const rs: RuleSet = { id: 'r', name: '', sources: [source('# 标题\n\nDOMAIN,a.test\nUSER-AGENT,x*\nDOMAIN,\nPROCESS-NAME,Example\nDOMAIN,a.test\nDOMAIN,last.test\n')] };
    const results = targets.map(t => convert(rs, t));
    expect(new Set(results.map(r => r.lines.length))).toEqual(new Set([8]));
    for (const r of results) {
      expect(r.lines[3]).toContain('本系统暂未支持解析');
      expect(r.lines[4]).toContain('输入格式有误');
      expect(r.lines[6]).toContain('重复规则');
      expect(r.lines[7]).toBe('DOMAIN,last.test');
      expect(r.stats.rejected).toBe(2);
      expect(r.origins[7]).toEqual({ sourceId: 'a', line: 8 });
    }
    expect(results[0]!.stats).toMatchObject({ parsed: 4, rejected: 2, output: 3, duplicates: 1, unsupported: 0 });
    expect(results[3]!.stats).toMatchObject({ output: 2, unsupported: 1 });
    expect(results[3]!.lines[5]).toContain('当前客户端无法输出');
  });

  it('多条替换、移除和组级追加为所有客户端预留稳定行位，保持首条匹配语义', () => {
    const rs: RuleSet = { id: 'r', name: '', sources: [source('DOMAIN,a.test\nDOMAIN,b.test\nDOMAIN,last.test')], overrides: [
      { match: 'DOMAIN,a.test', override: { when: { client: 'surge' }, action: { replace: [{ type: 'DOMAIN', value: 'x.test' }, { type: 'DOMAIN', value: 'y.test' }] } } },
      { match: 'DOMAIN,a.test', override: { when: { client: 'surge' }, action: { drop: true } } },
      { match: 'DOMAIN,b.test', override: { when: { client: 'surge', platform: 'ios' }, action: { drop: true } } },
      { override: { when: { client: 'mihomo' }, action: { append: [{ type: 'DOMAIN', value: 'extra.test' }] } } },
    ] };
    const results = targets.map(t => convert(rs, t));
    expect(new Set(results.map(r => r.lines.length))).toEqual(new Set([5]));
    for (const r of results) expect(r.lines[3]).toBe('DOMAIN,last.test');
    expect(results[0]!.lines[1]).toContain('预留');
    expect(results[3]!.lines[2]).toContain('改写移除');
    expect(results[3]!.lines[4]).toContain('追加未匹配');
    expect(results[3]!.stats).toMatchObject({ replaced: 1, removed: 1, appended: 0, output: 3 });
    expect(active(results[0]!)).toContain('DOMAIN,extra.test');
  });

  it('单来源可查看禁用来源，不去重、不追加组级规则', () => {
    const rs: RuleSet = { id: 'r', name: '', sources: [{ ...source('DOMAIN,a.test\nDOMAIN,a.test'), enabled: false }], overrides: [{ override: { when: { client: 'mihomo' }, action: { append: [{ type: 'DOMAIN', value: 'extra.test' }] } } }] };
    expect(active(convert(rs, targets[0]!, 'a'))).toEqual(['DOMAIN,a.test', 'DOMAIN,a.test']);
    expect(active(convert(rs, targets[0]!))).toEqual(['DOMAIN,extra.test']);
  });

  it('YAML 保留结构注释和原物理行定位，流式 YAML 按逻辑条目展开', () => {
    for (const content of ["payload:\n  - DOMAIN,a.test\n  - PROCESS-NAME,App\n  - USER-AGENT,x*\n", 'payload: ["DOMAIN,a.test", "PROCESS-NAME,App", "USER-AGENT,x*"]']) {
      const rs: RuleSet = { id: 'r', name: '', sources: [source(content)] };
      const results = targets.map(t => convert(rs, t));
      expect(new Set(results.map(r => r.lines.length)).size).toBe(1);
      expect(active(results[0]!)).toEqual(['DOMAIN,a.test', 'PROCESS-NAME,App']);
      expect(active(results[3]!)).toEqual(['DOMAIN,a.test']);
      expect(results[0]!.diagnostics[0]!.line).toBe(content.includes('\n') ? 4 : 1);
    }
  });

  it('畸形 YAML 不清理原文件，整份保留为注释，不影响其他来源', () => {
    const rs: RuleSet = { id: 'r', name: '', sources: [source('payload: [\n bad'), { ...source('DOMAIN,ok.test'), id: 'b' }] };
    const r = convert(rs, targets[0]!);
    expect(r.lines[0]).toMatch(/^# /);
    expect(r.lines[1]).toMatch(/^# /);
    expect(active(r)).toEqual(['DOMAIN,ok.test']);
    expect(r.stats.rejected).toBe(2);
  });

  it('超过 5000 行完整计算并保留末尾，不截断输入', () => {
    const rs: RuleSet = { id: 'r', name: '', sources: [source(Array.from({ length: 5100 }, (_, i) => `DOMAIN,d${i}.test`).join('\n'))] };
    const r = convert(rs, targets[0]!);
    expect(r.lines).toHaveLength(5100);
    expect(r.lines.at(-1)).toBe('DOMAIN,d5099.test');
  });
  it.each([
    '# 标题\nDOMAIN,a.test\nPROCESS-NAME,App\nUSER-AGENT,x*\nDOMAIN,a.test\nDOMAIN,',
    'payload:\n  - DOMAIN,a.test\n  - PROCESS-NAME,App\n  - USER-AGENT,x*',
    'payload: ["DOMAIN,a.test", "USER-AGENT,x*", "PROCESS-NAME,App"]',
  ])('不同替换宽度下四客户端的全部来源映射与行数稳定：%s', content => {
    for (let width = 1; width <= 8; width++) {
      const rs: RuleSet = { id: 'r', name: '', sources: [source(content)], overrides: [
        { match: 'DOMAIN,a.test', override: { when: { client: 'surge' }, action: {
          replace: Array.from({ length: width }, (_, i) => ({ type: 'DOMAIN' as const, value: `r${i}.test` })),
        } } },
        { override: { when: { client: 'mihomo' }, action: { append: [{ type: 'DOMAIN', value: 'append.test' }] } } },
      ] };
      const results = targets.map(t => convert(rs, t));
      for (const r of results) {
        expect(r.origins).toEqual(results[0]!.origins);
        expect(r.lines).toHaveLength(results[0]!.lines.length);
      }
    }
  });

});
