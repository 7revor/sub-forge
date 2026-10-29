import type { ReportItem } from '@sub-forge/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ItemIssues, TemplateReport } from './TemplateFields.tsx';

const issue: ReportItem = {
  level: 'error', code: 'template.empty-matcher', message: '请补全规则匹配项后再发布', where: 'rule:r_internal',
};

describe('模板校验提示', () => {
  it('行内保留错误说明，但不展示内部定位标识', () => {
    const markup = renderToStaticMarkup(<ItemIssues report={[issue]} where="rule:r_internal" />);
    expect(markup).toContain(issue.message);
    expect(markup).not.toContain('rule:r_internal');
    expect(renderToStaticMarkup(<ItemIssues report={[issue]} where="rule:other" />)).toBe('');
  });

  it('发布校验仍提供定位按钮，但不展示内部规则或策略组标识', () => {
    const groupIssue: ReportItem = { ...issue, code: 'template.empty-name', message: '请填写策略组名称', where: 'group:g_internal' };
    const markup = renderToStaticMarkup(<TemplateReport items={[issue, groupIssue]} onLocate={() => {}} />);
    expect(markup).toContain(issue.message);
    expect(markup).toContain(groupIssue.message);
    expect(markup.match(/<button /g)).toHaveLength(2);
    expect(markup).toContain('定位');
    expect(markup).not.toContain('rule:r_internal');
    expect(markup).not.toContain('group:g_internal');
  });
});
