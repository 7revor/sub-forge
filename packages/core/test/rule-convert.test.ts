import { describe, expect, it } from 'vitest';
import { convertRuleDocuments, prepareRuleDocument, type RuleConversion } from '../src/rules/convert.ts';
import type { ClientCtx } from '../src/rules/client.ts';
import type { RuleSet } from '../src/types.ts';

const targets: ClientCtx[] = [{ client: 'mihomo' }, { client: 'surge' }, { client: 'loon' }, { client: 'stash' }];
const source = (content: string) => ({ id: 'a', kind: 'local' as const, format: 'auto' as const, content });
function convert(rs: RuleSet, ctx: ClientCtx, sourceId?: string) {
  return convertRuleDocuments(rs, new Map(rs.sources.map(s => [s.id, prepareRuleDocument(s.content ?? '', s)])), ctx, { sourceId });
}
const active = (r: RuleConversion) => r.lines.filter(l => l.trim() && !l.trimStart().startsWith('#'));

describe('保留行位的通用规则转换', () => {
  it('多来源按原顺序转换，保留来源级改写范围、禁用状态及原文 no-resolve', () => {
    const remote = { id: 'remote', kind: 'remote' as const, format: 'auto' as const, url: 'https://example.test/rules.list' };
    const rs: RuleSet = { id: 'r', name: '多来源', noResolve: true, sources: [
      source('DOMAIN,same.test\nIP-CIDR,192.0.2.0/24\nIP-CIDR,198.51.100.0/24,no-resolve'),
      { ...source('DOMAIN,same.test\nDOMAIN,legacy.test'), id: 'legacy', overrides: [
        { line: 1, override: { when: { client: 'surge' }, action: { drop: true } } },
        { match: 'DOMAIN,legacy.test', override: { when: { client: 'surge' }, action: { replace: [{ type: 'DOMAIN', value: 'replaced.test' }] } } },
      ] },
      { ...source('DOMAIN,disabled.test'), id: 'disabled', enabled: false }, remote,
    ] };
    const documents = new Map(rs.sources.map(s => [s.id, prepareRuleDocument(s.kind === 'remote' ? 'DOMAIN,remote.test' : s.content ?? '', s)]));
    const surge = convertRuleDocuments(rs, documents, { client: 'surge' });
    expect(active(surge)).toEqual(['DOMAIN,same.test', 'IP-CIDR,192.0.2.0/24', 'IP-CIDR,198.51.100.0/24,no-resolve', 'DOMAIN,replaced.test', 'DOMAIN,remote.test']);
    expect(surge.stats).toMatchObject({ parsed: 6, output: 5, removed: 1, replaced: 1, duplicates: 0 });
    expect(surge.origins.at(-1)).toEqual({ sourceId: 'remote', line: 1 });
    const mihomo = convertRuleDocuments(rs, documents, { client: 'mihomo' });
    expect(active(mihomo)).toContain('DOMAIN,legacy.test');
    expect(mihomo.stats).toMatchObject({ output: 5, removed: 0, replaced: 0, duplicates: 1 });
  });

  it('组级首条改写优先于旧来源改写，跨来源替换后去重并保留相对顺序', () => {
    const rs: RuleSet = { id: 'r', name: '改写', sources: [
      { ...source('DOMAIN,same.test\nDOMAIN,first.test'), overrides: [{ line: 1, override: { when: { client: 'mihomo' }, action: { drop: true } } }] },
      { ...source('DOMAIN,same.test\nDOMAIN,second.test'), id: 'b' },
    ], overrides: [
      { match: 'DOMAIN,same.test', override: { when: { client: 'mihomo' }, action: { replace: [{ type: 'IP-CIDR', value: '192.0.2.0/24' }] } } },
      { match: 'DOMAIN,same.test', override: { when: { client: 'mihomo' }, action: { drop: true } } },
    ] };
    const result = convert(rs, { client: 'mihomo' });
    expect(active(result)).toEqual(['IP-CIDR,192.0.2.0/24', 'DOMAIN,first.test', 'DOMAIN,second.test']);
    expect(result.stats).toMatchObject({ replaced: 2, removed: 0, duplicates: 1, output: 3 });
    expect(active(convert(rs, { client: 'surge' }))).toEqual(['DOMAIN,same.test', 'DOMAIN,first.test', 'DOMAIN,second.test']);
    rs.sources.reverse();
    expect(active(convert(rs, { client: 'mihomo' }))).toEqual(['IP-CIDR,192.0.2.0/24', 'DOMAIN,second.test', 'DOMAIN,first.test']);
  });

  it('组级追加只执行一次，不再次应用内容改写，禁用全部来源后仍按内核追加', () => {
    const rs: RuleSet = { id: 'r', name: '追加', noResolve: true,
      sources: ['a', 'b'].map(id => ({ ...source('DOMAIN,keep.test'), id })), overrides: [
        { override: { when: { client: 'surge' }, action: { append: [
          { type: 'DOMAIN', value: 'added.test' }, { type: 'DOMAIN', value: 'keep.test' }, { type: 'IP-CIDR', value: '192.0.2.0/24' },
        ] } } },
        { override: { when: { client: 'surge' }, action: { append: [{ type: 'DOMAIN', value: 'second.test' }] } } },
        { match: 'DOMAIN,added.test', override: { when: { client: 'surge' }, action: { drop: true } } },
      ],
    };
    const surge = convert(rs, { client: 'surge' });
    expect(active(surge)).toEqual(['DOMAIN,keep.test', 'DOMAIN,added.test', 'IP-CIDR,192.0.2.0/24', 'DOMAIN,second.test']);
    expect(surge.stats).toMatchObject({ parsed: 2, appended: 4, duplicates: 2, removed: 0, output: 4 });
    expect(active(convert(rs, { client: 'mihomo' }))).toEqual(['DOMAIN,keep.test']);
    rs.sources.forEach(s => { s.enabled = false; });
    expect(active(convert(rs, { client: 'surge' }))).toEqual(['DOMAIN,added.test', 'DOMAIN,keep.test', 'IP-CIDR,192.0.2.0/24', 'DOMAIN,second.test']);
    expect(active(convert(rs, { client: 'mihomo' }))).toEqual([]);
  });

  it.each(['PROCESS-NAME-WILDCARD', 'PROCESS-PATH-WILDCARD', 'DOMAIN-WILDCARD'])('mihomo 的 %s 按小写去重并保留首条原文与来源行位', type => {
    const rs: RuleSet = { id: 'r', name: '', sources: [source(`${type},/Apps/Example*\n${type},/apps/example*\n${type},/Apps/Other*`)] };
    const result = convert(rs, { client: 'mihomo' });
    expect(active(result)).toEqual([`${type},/Apps/Example*`, `${type},/Apps/Other*`]);
    expect(result.stats).toMatchObject({ output: 2, duplicates: 1 });
    expect(result.lines[1]).toBe(`# [重复规则] ${type},/apps/example*`);
    expect(result.origins).toEqual([1, 2, 3].map(line => ({ sourceId: 'a', line })));
    expect(convert(rs, { client: 'surge' }).stats.duplicates).toBe(0);
    expect(active(convert(rs, { client: 'mihomo' }, 'a'))).toHaveLength(3);
  });

  it('大小写去重贯穿来源、替换及追加，但不混淆名称/路径或精确/正则规则', () => {
    const rs: RuleSet = { id: 'r', name: '', sources: [source([
      'PROCESS-NAME-WILDCARD,App*', 'DOMAIN,replace.test',
      'PROCESS-PATH-WILDCARD,App*', 'PROCESS-NAME,App', 'PROCESS-NAME,app',
      'PROCESS-NAME-REGEX,^App', 'PROCESS-NAME-REGEX,^app',
    ].join('\n')), { ...source('PROCESS-NAME-WILDCARD,app*'), id: 'b' }], overrides: [
      { match: 'DOMAIN,replace.test', override: { when: { client: 'mihomo' }, action: { replace: [{ type: 'PROCESS', kind: 'name', mode: 'wildcard', value: 'APP*' }] } } },
      { override: { when: { client: 'mihomo' }, action: { append: [{ type: 'PROCESS', kind: 'name', mode: 'wildcard', value: 'aPP*' }] } } },
    ] };
    const result = convert(rs, { client: 'mihomo' });
    expect(result.stats).toMatchObject({ duplicates: 3, replaced: 1, appended: 1, output: 6 });
    expect(active(result)).toEqual([
      'PROCESS-NAME-WILDCARD,App*', 'PROCESS-PATH-WILDCARD,App*',
      'PROCESS-NAME,App', 'PROCESS-NAME,app', 'PROCESS-NAME-REGEX,^App', 'PROCESS-NAME-REGEX,^app',
    ]);
  });

  it.each(['USER-AGENT,PayPal*', 'payload: ["USER-AGENT,PayPal*"]'])('USER-AGENT 来源正常解析，按客户端输出并保持行位：%s', content => {
    const src = source(content);
    const doc = prepareRuleDocument(content, src);
    expect(doc.parsed).toBe(1);
    expect(doc.diagnostics).toEqual([]);
    const results = targets.map(ctx => convert({ id: 'r', name: '', sources: [src] }, ctx));
    for (const [i, result] of results.entries()) {
      const unsupported = targets[i]!.client === 'mihomo';
      expect(result.stats).toMatchObject({ parsed: 1, rejected: 0, output: unsupported ? 0 : 1, unsupported: unsupported ? 1 : 0 });
      expect(result.origins).toEqual(results[0]!.origins);
      if (unsupported) {
        expect(active(result)).toEqual([]);
        expect(result.lines.join('\n')).toContain('# [mihomo 不支持 USER-AGENT] USER-AGENT,PayPal*');
        expect(result.diagnostics).toMatchObject([{ kind: 'client', line: 1 }]);
      } else {
        expect(active(result)).toEqual(['USER-AGENT,PayPal*']);
        expect(result.diagnostics).toEqual([]);
      }
    }
  });

  it('Stash 进程规则保留原文和行位，由终端决定是否使用', () => {
    const text = 'PROCESS-NAME,Example';
    const rs: RuleSet = { id: 'r', name: '', sources: [source(`# 进程\n${text}\nDOMAIN,last.test`)] };
    const result = convert(rs, { client: 'stash' });
    expect(result.diagnostics).toEqual([]);
    expect(result.lines).toEqual(['# 进程', text, 'DOMAIN,last.test']);
    expect(result.origins).toEqual([1, 2, 3].map(line => ({ sourceId: 'a', line })));
  });

  it('四个客户端保留原注释、空行、未解析、重复和不兼容规则的位置', () => {
    const rs: RuleSet = { id: 'r', name: '', sources: [source('# 标题\n\nDOMAIN,a.test\nUNKNOWN,x*\nDOMAIN,\nPROCESS-NAME,Example\nDOMAIN,a.test\nDOMAIN,last.test\n')] };
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
    expect(results[1]!.stats).toMatchObject({ output: 3, unsupported: 0 });
    expect(results[1]!.lines[5]).toBe('PROCESS-NAME,Example');
  });

  it('多条替换、移除和组级追加为所有客户端预留稳定行位，保持首条匹配语义', () => {
    const rs: RuleSet = { id: 'r', name: '', sources: [source('DOMAIN,a.test\nDOMAIN,b.test\nDOMAIN,last.test')], overrides: [
      { match: 'DOMAIN,a.test', override: { when: { client: 'surge' }, action: { replace: [{ type: 'DOMAIN', value: 'x.test' }, { type: 'DOMAIN', value: 'y.test' }] } } },
      { match: 'DOMAIN,a.test', override: { when: { client: 'surge' }, action: { drop: true } } },
      { match: 'DOMAIN,b.test', override: { when: { client: 'surge' }, action: { drop: true } } },
      { override: { when: { client: 'mihomo' }, action: { append: [{ type: 'DOMAIN', value: 'extra.test' }] } } },
    ] };
    const results = targets.map(t => convert(rs, t));
    expect(new Set(results.map(r => r.lines.length))).toEqual(new Set([5]));
    for (const r of results) expect(r.lines[3]).toBe('DOMAIN,last.test');
    expect(results[0]!.lines[1]).toContain('预留');
    expect(results[1]!.lines[2]).toContain('改写移除');
    expect(results[1]!.lines[4]).toContain('追加未匹配');
    expect(results[1]!.stats).toMatchObject({ replaced: 1, removed: 1, appended: 0, output: 3 });
    expect(active(results[0]!)).toContain('DOMAIN,extra.test');
  });

  it('单来源可查看禁用来源，不去重、不追加组级规则', () => {
    const rs: RuleSet = { id: 'r', name: '', sources: [{ ...source('DOMAIN,a.test\nDOMAIN,a.test'), enabled: false }], overrides: [{ override: { when: { client: 'mihomo' }, action: { append: [{ type: 'DOMAIN', value: 'extra.test' }] } } }] };
    expect(active(convert(rs, targets[0]!, 'a'))).toEqual(['DOMAIN,a.test', 'DOMAIN,a.test']);
    expect(active(convert(rs, targets[0]!))).toEqual(['DOMAIN,extra.test']);
  });

  it('YAML 保留结构注释和原物理行定位，流式 YAML 按逻辑条目展开', () => {
    for (const content of ["payload:\n  - DOMAIN,a.test\n  - PROCESS-NAME,App\n  - UNKNOWN,x*\n", 'payload: ["DOMAIN,a.test", "PROCESS-NAME,App", "UNKNOWN,x*"]']) {
      const rs: RuleSet = { id: 'r', name: '', sources: [source(content)] };
      const results = targets.map(t => convert(rs, t));
      expect(new Set(results.map(r => r.lines.length)).size).toBe(1);
      expect(active(results[0]!)).toEqual(['DOMAIN,a.test', 'PROCESS-NAME,App']);
      expect(active(results[1]!)).toEqual(['DOMAIN,a.test', 'PROCESS-NAME,App']);
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
    '# 标题\nDOMAIN,a.test\nPROCESS-NAME,App\nUNKNOWN,x*\nDOMAIN,a.test\nDOMAIN,',
    'payload:\n  - DOMAIN,a.test\n  - PROCESS-NAME,App\n  - UNKNOWN,x*',
    'payload: ["DOMAIN,a.test", "UNKNOWN,x*", "PROCESS-NAME,App"]',
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
