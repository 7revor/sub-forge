import { describe, expect, it } from 'vitest';
import type { Matcher } from '@sub-forge/core';
import { changeMatcherKind } from './matcher.ts';

describe('匹配类型切换', () => {
  it('切换到规则集时清理单条规则及客户端覆盖，保留扩展字段', () => {
    const rule = { kind: 'rule', rule: { type: 'DOMAIN', value: 'example.test' }, overrides: [], extension: '保留' } as Matcher;
    expect(changeMatcherKind(rule, 'ruleset')).toEqual({ kind: 'ruleset', id: '', extension: '保留' });
  });
  it('切回规则时清空规则集引用，重复选择不会重置草稿', () => {
    const set: Matcher = { kind: 'ruleset', id: 'rs_test' };
    expect(changeMatcherKind(set, 'ruleset')).toBe(set);
    expect(changeMatcherKind(set, 'rule')).toEqual({ kind: 'rule', rule: { type: 'DOMAIN', value: '' } });
  });
});
