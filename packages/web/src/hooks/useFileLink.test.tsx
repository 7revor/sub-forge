import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { remoteRuleMatcher } from '@sub-forge/core';
import { ruleFileHref, repositoryFileHref } from './useFileLink.ts';
import { RuleCard } from '../components/RuleCard.tsx';

it('文件链接编码身份、保留仓库路径且草稿改变时更新一致性标记', () => {
  const matcher = remoteRuleMatcher('https://example.test/one.list');
  const context = { kind: 'profiles' as const, id: '订阅 / 一' };
  const first = ruleFileHref('令牌/一', context, 'rule/a', matcher)!;
  const url = new URL(first, 'https://local.test');
  expect(url.pathname).toContain(encodeURIComponent(context.id));
  expect(first).not.toBe(ruleFileHref('令牌/一', context, 'rule/a', remoteRuleMatcher('https://example.test/two.list')));
  expect(ruleFileHref(undefined, context, 'r', matcher)).toBeUndefined();
  expect(ruleFileHref('t', { ...context, id: 'new' }, 'r', matcher)).toBeUndefined();
  expect(ruleFileHref('t', context, 'r', { kind: 'local', content: '' })).toBeUndefined();
  const path = '路径/文件 & 名称.list';
  const repo = new URL(repositoryFileHref('t', { repo: '公共仓库', ref: 'a/b', path })!, 'https://local.test');
  expect(repo.searchParams.get('path')).toBe(path);
  expect(repo.searchParams.get('ref')).toBe('a/b');
});

it('非静态卡片使用独立标签页链接，静态规则继续使用弹窗按钮', () => {
  const props = { label: '规则', handle: null, icon: null, onPreview() {}, onEdit() {}, onDelete() {} };
  const external = renderToStaticMarkup(<RuleCard {...props} externalPreview previewHref="/api/files/t/templates/a/rules/r">文件</RuleCard>);
  expect(external).toContain('href="/api/files/t/templates/a/rules/r"');
  expect(external).toContain('target="_blank"'); expect(external).toContain('rel="noreferrer noopener"');
  expect(external).not.toContain('aria-label="预览规则"');
  const local = renderToStaticMarkup(<RuleCard {...props}>静态</RuleCard>);
  expect(local).toContain('aria-label="预览规则"'); expect(local).not.toContain('target="_blank"');
});
