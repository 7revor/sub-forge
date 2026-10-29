import { describe, expect, it } from 'vitest';
import { recoverYaml } from './recoverYaml.ts';

describe('返回表单时恢复 YAML', () => {
  it('不闭合的列表只丢弃受影响字段，保留前后及嵌套的有效字段', () => {
    const result = recoverYaml('name: 有效节点\nserver: [\nport: 443\ndns:\n  enable: true\n  nameserver: [\n');
    expect(result.value).toEqual({ name: '有效节点', port: 443, dns: { enable: true } });
    expect(result.notes.join()).toContain('server');
    expect(result.notes.join()).toContain('dns.nameserver');
  });

  it('重复键保留第一项，不把坏引号吞入的后续文本当作有效字符串', () => {
    const result = recoverYaml('mode: rule\nmode: global\nsecret: "未闭合\nport: 7890\n');
    expect(result.value).toEqual({ mode: 'rule' });
    expect(result.notes.join()).toContain('重复项');
    expect(result.notes.join()).toContain('secret');
  });

  it('保留合法锚点内容，丢弃无效和循环引用而保留同级字段', () => {
    const result = recoverYaml('dns: &dns { enable: true }\ncopy: *dns\nmissing: *missing\nloop: &loop { self: *loop, keep: 1 }\nmode: rule\n');
    expect(result.value).toEqual({ dns: { enable: true }, copy: { enable: true }, loop: { keep: 1 }, mode: 'rule' });
    expect(result.notes.join()).toContain('锚点不存在');
    expect(result.notes.join()).toContain('循环引用');
    expect(() => JSON.stringify(result.value)).not.toThrow();
  });

  it('空值与未知扩展保留，非有限数和未知标签被忽略', () => {
    const result = recoverYaml('future: { nil: null, zero: 0, list: [true, 7] }\nbad: .inf\ntagged: !unknown hello\n');
    expect(result.value).toEqual({ future: { nil: null, zero: 0, list: [true, 7] } });
    expect(result.notes).toHaveLength(2);
  });

  it.each(['', '[]', 'plain text', 'false'])('没有有效映射时也能返回空表单：%s', (text) => {
    const result = recoverYaml(text);
    expect(result.value).toEqual({});
    expect(result.notes.length).toBeGreaterThan(0);
  });

  it('移除首项不会把它的身份注释转移给下一项', () => {
    const result = recoverYaml('rules:\n  # sub-forge-rule: bad\n  # disabled\n  - [\n  # sub-forge-rule: good\n  - DOMAIN,example.com,DIRECT\n');
    const yaml = result.doc.toString();
    expect(result.value).toEqual({ rules: ['DOMAIN,example.com,DIRECT'] });
    expect(yaml).toContain('sub-forge-rule: good');
    expect(yaml).not.toContain('sub-forge-rule: bad');
    expect(yaml).not.toContain('disabled');
  });
});
