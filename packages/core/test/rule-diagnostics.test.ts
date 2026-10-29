import { describe, expect, it } from 'vitest';
import { rejectedRuleReport } from '../src/rules/diagnostics.ts';
import { parseRuleSetContent } from '../src/rules/parse.ts';

describe('规则解析原因分类', () => {
  it('分类来自错误类型，不依赖原因文本包含的词语', () => {
    const result = parseRuleSetContent('DOMAIN,ok.test\nUNKNOWN,App*\nDOMAIN,', 'classical');
    expect(result).toMatchObject({ rejected: [
      { line: 2, kind: 'unimplemented' }, { line: 3, kind: 'invalid' },
    ] });
  });

  it('YAML 使用真实文件行号，多来源保留序号，仅显示有问题的分类', () => {
    const result = rejectedRuleReport('# 注释\npayload:\n  - DOMAIN,ok.test\n  - UNKNOWN,App*', { id: 's', kind: 'local', format: 'auto' }, 2);
    expect(result).toEqual({ message: '类型不支持：1 行', ruleIssues: [
      { source: 3, line: 4, kind: 'unimplemented', reason: '不支持的规则类型 UNKNOWN' },
    ] });
  });

  it('格式错误单独汇总，空列表不产生错误计数', () => {
    const source = { id: 's', kind: 'local' as const, format: 'auto' as const };
    expect(rejectedRuleReport('DOMAIN,ok.test\nDOMAIN,', source, 0).message).toBe('写法有误：1 行');
    expect(rejectedRuleReport('DOMAIN,ok.test', source, 0)).toEqual({ message: '', ruleIssues: [] });
    expect(rejectedRuleReport('USER-AGENT,App*', source, 0)).toEqual({ message: '', ruleIssues: [] });
  });
});
