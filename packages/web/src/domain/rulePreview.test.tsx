import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { type Matcher } from '@sub-forge/core';
import { rulePreviewLinks, sourcePreviewHref } from './rulePreview.ts';
import { RuleCard } from '../components/RuleCard.tsx';

it('远程源预览保留原始查询参数与编码，不依赖令牌、保存状态或客户端', () => {
  const url = 'https://example.test/路径/%E6%96%87%E4%BB%B6.list?v=2&raw=true#L3';
  expect(sourcePreviewHref({ kind: 'remote', url })).toBe(url);
  expect(rulePreviewLinks({ kind: 'ruleset', id: '', remote: { url } })).toEqual([{ href: url }]);
  for (const url of ['', 'javascript:alert(1)', 'data:text/html,test', '/resources/rule', 'https://']) {
    expect(sourcePreviewHref({ kind: 'remote', url })).toBeUndefined();
  }
  expect(sourcePreviewHref({ kind: 'local', url })).toBeUndefined();
});

it('仓库引用逐文件直达 raw 地址，旧多文件引用不丢失来源、不拼接或转成托管链接', () => {
  const urls = ['a', 'b'].map(name => `https://raw.githubusercontent.com/example/rules/main/${name}.list`);
  const matcher: Matcher = { kind: 'ruleset', id: '', repository: { repo: 'example', entry: 'all', name: '公共仓库', sources: urls.map((url, i) => ({ id: String(i), kind: 'remote', format: 'auto', url })) } };
  expect(rulePreviewLinks(matcher).map(link => link.href)).toEqual(urls);
  matcher.repository!.sources[0]!.enabled = false;
  expect(rulePreviewLinks(matcher).map(link => link.href)).toEqual([urls[1]]);
});

it('系统规则集合带令牌打开托管原文，不跳配置页；本地正文不创建外部链接', () => {
  expect(rulePreviewLinks({ kind: 'ruleset', id: '增强 / 一' }, 'tok')[0]?.href).toBe(`/resources/ruleset?${new URLSearchParams({ id: '增强 / 一', token: 'tok' })}`);
  expect(rulePreviewLinks({ kind: 'ruleset', id: '增强' })).toEqual([]);
  expect(rulePreviewLinks({ kind: 'local', content: 'DOMAIN,example.test' }, 'tok')).toEqual([]);
  expect(rulePreviewLinks({ kind: 'ruleset', id: '' }, 'tok')).toEqual([]);
});

it('链接不可用时说明原因，不沿用地址校验文案', () => {
  const props = { label: '规则', handle: null, kind: 'collection' as const, externalPreview: true, onPreview() {}, onEdit() {}, onDelete() {} };
  expect(renderToStaticMarkup(<RuleCard {...props} previewHint="访问令牌读取失败：boom">集合</RuleCard>)).toContain('title="访问令牌读取失败：boom"');
  expect(renderToStaticMarkup(<RuleCard {...props}>集合</RuleCard>)).toContain('title="请填写有效的源文件地址"');
});

it('源文件使用新标签页原生链接，本地规则保留预览按钮', () => {
  const props = { label: '规则', handle: null, kind: 'local' as const, onPreview() {}, onEdit() {}, onDelete() {} };
  const external = renderToStaticMarkup(<RuleCard {...props} externalPreview previewLinks={[{ href: 'https://example.test/a.list' }]}>文件</RuleCard>);
  expect(external).toContain('href="https://example.test/a.list"');
  expect(external).toContain('target="_blank"');
  expect(external).toContain('rel="noreferrer noopener"');
  expect(external).not.toContain('保存后');
  const local = renderToStaticMarkup(<RuleCard {...props}>本地</RuleCard>);
  expect(local).toContain('aria-label="预览规则"');
  expect(local).not.toContain('target="_blank"');
});
