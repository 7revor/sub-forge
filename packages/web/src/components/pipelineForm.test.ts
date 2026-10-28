import { describe, expect, it } from 'vitest';
import { regexError, setFieldsError, updateSetField } from './pipelineForm.ts';

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
