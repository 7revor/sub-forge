import { describe, expect, it } from 'vitest';
import { patternHits, regexError, renameHits, rowHit, setFieldsError, updateSetField } from './pipelineForm.ts';

describe('处理链表单校验', () => {
  it('遵循内核的身份与隐式字段限制', () => {
    for (const key of ['name', 'type', 'server', 'port', '_key', '_source', '_custom']) {
      expect(setFieldsError({ [key]: true })).toContain(key);
    }
    expect(setFieldsError({ udp: false, 'ws-opts': { path: '/ws' }, custom: 1 })).toBeUndefined();
  });
  it('取消设置时删除键，保留未覆盖的嵌套字段与关闭值', () => {
    const fields = { udp: true, tfo: false, custom: { nested: [1, 2] } };
    const next = updateSetField(fields, 'udp', undefined);
    expect(next).toEqual({ tfo: false, custom: { nested: [1, 2] } });
    expect(fields.udp).toBe(true);
    expect(updateSetField(next, 'udp', false).udp).toBe(false);
  });
  it('支持忽略大小写前缀并报告非法正则和 flags', () => {
    expect(regexError('(?i)香港|hk')).toBeUndefined();
    expect(regexError('(?i)hk', 'g')).toBeUndefined();
    expect(regexError('[')).toContain('非法正则');
    expect(regexError('hk', 'gg')).toContain('非法正则');
    expect(regexError('')).toBeUndefined();
  });
});

describe('处理链命中统计', () => {
  it('正则改名逐条命中，空规则与非法规则不计数', () => {
    const rules = [{ pattern: '^香港\\s*(\\d+)', replace: 'HK-$1' }, { pattern: '^HK', replace: 'hk' }, { pattern: '', replace: 'x' }, { pattern: '[', replace: '' }];
    expect(renameHits(rules, ['香港 01', 'HK 02', 'JP'])).toEqual([1, 2, undefined, undefined]);
    expect(rowHit({ op: 'rename.regex', rules }, '香港 01')).toBe('#1、#2');
    expect(rowHit({ op: 'rename.regex', rules }, 'JP')).toBe('未命中');
  });
  it('过滤类按第一条命中的正则标注', () => {
    expect(patternHits(['(?i)hk', '', 'JP'], ['hk 1', 'HK 2', 'US'])).toEqual([2, undefined, 0]);
    expect(rowHit({ op: 'filter.regex', patterns: ['US', 'HK'], keep: false }, 'HK 1')).toBe('#2');
    expect(rowHit({ op: 'filter.useless' }, '剩余流量 1G')).toBe('剩余流量');
  });
});
