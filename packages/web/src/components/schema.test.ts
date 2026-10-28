import { describe, expect, it } from 'vitest';
import { getPath, knownKeys, otherFields, replaceOtherFields, setPath, type FieldGroup } from './schema.ts';

const groups: FieldGroup[] = [{
  title: '设置',
  fields: [
    { key: 'port', label: '端口', type: 'number' },
    { key: 'dns.enable', label: 'DNS', type: 'bool' },
    { key: 'dns.nested.known', label: '嵌套', type: 'string', showIf: () => false },
    { key: 'hosts', label: '主机', type: 'kv' },
  ],
}];

describe('字段路径', () => {
  it('读取嵌套路径和缺失值，不读取原型属性', () => {
    expect(getPath({ dns: { 'enhanced-mode': 'fake-ip' } }, 'dns.enhanced-mode')).toBe('fake-ip');
    expect(getPath({}, 'dns.enable')).toBeUndefined();
    expect(getPath({ dns: null }, 'dns.enable')).toBeUndefined();
    expect(getPath({}, 'toString')).toBeUndefined();
  });
  it('不可变设置，保留同级字段和未修改的分支', () => {
    const source = { dns: { enable: false, extra: 1 }, hosts: { a: 'b' } };
    const result = setPath(source, 'dns.enhanced-mode', 'fake-ip');
    expect(result).toEqual({ dns: { enable: false, extra: 1, 'enhanced-mode': 'fake-ip' }, hosts: { a: 'b' } });
    expect(source).toEqual({ dns: { enable: false, extra: 1 }, hosts: { a: 'b' } });
    expect(result.dns).not.toBe(source.dns);
    expect(result.hosts).toBe(source.hosts);
  });
  it('创建多级对象，允许 false、0、null', () => {
    expect(setPath({}, 'a.b.c', 0)).toEqual({ a: { b: { c: 0 } } });
    expect(setPath({}, 'a.b', false)).toEqual({ a: { b: false } });
    expect(setPath({}, 'a', null)).toEqual({ a: null });
  });
  it('删除后逐层清理空父对象，不修改原对象', () => {
    const source = { a: { b: { c: 1 } }, untouched: true };
    expect(setPath(source, 'a.b.c', undefined)).toEqual({ untouched: true });
    expect(source).toEqual({ a: { b: { c: 1 } }, untouched: true });
    expect(setPath({ a: { b: 1, c: 2 } }, 'a.b', undefined)).toEqual({ a: { c: 2 } });
    expect(setPath({ a: 1 }, 'a.b', undefined)).toEqual({ a: 1 });
  });
  it('拒绝空路径和原型污染路径', () => {
    for (const key of ['', 'a..b', '__proto__.x', 'constructor.prototype.x']) {
      expect(() => setPath({}, key, true)).toThrow();
    }
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

describe('其他字段', () => {
  it('列出已知路径，包括条件隐藏字段', () => {
    expect([...knownKeys(groups)]).toEqual(['port', 'dns.enable', 'dns.nested.known', 'hosts']);
  });
  it('只去除已知字段，未知对象完整保留', () => {
    const unknown = { nested: { x: 1 }, list: ['a'] };
    expect(otherFields({ port: 80, hosts: { a: 'b' }, unknown }, groups)).toEqual({ unknown });
    expect(otherFields({ unknown }, groups).unknown).toBe(unknown);
  });
  it('逐层比较混合嵌套键，保留未知空对象和数组', () => {
    expect(otherFields({
      dns: { enable: false, nested: { known: 'x', unknown: 2 }, extra: {}, servers: ['a'] },
      port: 0,
    }, groups)).toEqual({ dns: { nested: { unknown: 2 }, extra: {}, servers: ['a'] } });
    expect(otherFields({ dns: { enable: false, nested: { known: 'x' } } }, groups)).toEqual({});
    expect(otherFields({ dns: null }, groups)).toEqual({ dns: null });
  });
  it('替换其他字段不丢失隐藏字段，也不接受对已知字段的覆盖', () => {
    const source = { port: 0, dns: { enable: false, nested: { known: 'x', old: 1 } }, old: true };
    expect(replaceOtherFields(source, { port: 99, dns: { enable: true, new: 2 } }, groups))
      .toEqual({ port: 0, dns: { enable: false, nested: { known: 'x' }, new: 2 } });
    expect(source.dns.nested.old).toBe(1);
  });
});
