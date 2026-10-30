import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReportItem } from '@sub-forge/core';
import { CodePreview } from '../../components/CodePreview.tsx';
import { PreviewReport } from './PreviewReport.tsx';
import { indexPreview, locatePreviewIssue } from './previewReport.ts';

const issue = (where: string, code = 'group.empty'): ReportItem => ({ level: 'warn', code, where, message: '组「香港」没有成员，按拒绝输出' });

describe('预览报告定位', () => {
  it('按 YAML 结构定位完整组，不误匹配同名节点、前缀名称或带标点的名称', () => {
    const text = [
      'proxies:', '  - name: 香港', '    type: socks5', 'proxy-groups:',
      '  - name: 香港备用', '    type: select', '  - name: "香港: [测试]"', '    type: select', '    proxies:', '      - REJECT',
      'rules:', '  - MATCH,DIRECT', '',
    ].join('\n');
    const index = indexPreview(text);
    expect(locatePreviewIssue(issue('group:id'), index, [{ id: 'id', name: '香港: [测试]' }])).toEqual({ startLine: 7, endLine: 10 });
    expect(locatePreviewIssue(issue('proxy:香港'), index, [])).toEqual({ startLine: 2, endLine: 3 });
    expect(locatePreviewIssue(issue('group:香港'), index, [{ id: 'id', name: '香港备用' }])).toBeUndefined();
    expect(locatePreviewIssue(issue('final'), index, [])).toEqual({ startLine: 12, endLine: 12 });
  });

  it('业务 ID 与输出名称碰撞时，依据诊断来源选择正确的组', () => {
    const index = indexPreview('proxy-groups:\n  - name: 同名ID\n    type: select\n  - name: 另一个组\n    type: select\n');
    const groups = [{ id: '同名ID', name: '另一个组' }];
    expect(locatePreviewIssue(issue('group:同名ID'), index, groups)?.startLine).toBe(4);
    expect(locatePreviewIssue(issue('group:同名ID', 'verify.dangling'), index, groups)?.startLine).toBe(2);
  });

  it('Surge 与 Loon 的 INI 仅匹配正确段落中的名称', () => {
    const index = indexPreview('[General]\n香港 = value\n[Proxy]\n香港 = socks5, example.test, 1080\n[Proxy Group]\n香港备用 = select, DIRECT\n香港 = select, REJECT\n[Rule]\nFINAL,DIRECT\n', 'ini');
    expect(locatePreviewIssue(issue('group:hk'), index, [{ id: 'hk', name: '香港' }])).toEqual({ startLine: 7, endLine: 7 });
    expect(locatePreviewIssue(issue('proxy:香港'), index, [])).toEqual({ startLine: 4, endLine: 4 });
    expect(locatePreviewIssue(issue('final'), index, [])).toEqual({ startLine: 9, endLine: 9 });
  });

  it('重复名称、无效文档及未输出问题不提供虚假定位', () => {
    const index = indexPreview('proxy-groups:\n  - name: 重复\n  - name: 重复\n');
    expect(locatePreviewIssue(issue('group:g'), index, [{ id: 'g', name: '重复' }])).toBeUndefined();
    expect(locatePreviewIssue(issue('rule:missing', 'rule.dropped'), index, [])).toBeUndefined();
    expect(indexPreview('proxy-groups: [').groups.size).toBe(0);
  });

  it('单行报告不展示内部代码与 ID，仅有对应输出的条目可点击', () => {
    const items = [issue('group:private-id'), { ...issue('rule:removed', 'rule.dropped'), message: 'Mihomo 不支持此规则' }];
    const markup = renderToStaticMarkup(<PreviewReport items={items} locations={[{ startLine: 7, endLine: 10 }, undefined]} onLocate={() => {}} selected={0} />);
    expect(markup).toContain('「香港」为空，将拒绝连接');
    expect(markup).toContain('点击定位第 7 行');
    expect(markup).toContain('组「香港」没有成员，按拒绝输出');
    expect(markup).not.toContain('private-id');
    expect(markup).not.toContain('group.empty');
    expect(markup.match(/<button /g)).toHaveLength(1);
    expect(markup).toContain('aria-pressed="true"');
  });

  it('高亮不改写原文，支持空行和特殊字符，默认没有复制按钮', () => {
    const text = '第一行\n\n<&>\n最后一行\n';
    const markup = renderToStaticMarkup(<CodePreview text={text} highlight={{ startLine: 2, endLine: 3 }} />);
    expect(markup).toContain('第一行\n<mark');
    expect(markup).toContain('\n&lt;&amp;&gt;</mark>\n最后一行\n');
    expect(markup).toContain('已定位第 2 至 3 行');
    expect(markup).not.toContain('<button');
    expect(renderToStaticMarkup(<CodePreview text={text} highlight={{ startLine: 0, endLine: 2 }} />)).not.toContain('<mark');
  });
});
