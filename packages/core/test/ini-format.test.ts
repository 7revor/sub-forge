import { describe, expect, it } from 'vitest';
import { parseIniBase, stringifyIniBase } from '../src/render/ini-format.ts';

describe('INI 基础配置编解码', () => {
  it('保留 false、0、列表、引号，并正确移除注释', () => {
    const text = '[General] # 段注释\nIPV6 = false ; 注释\ntest-timeout = 0 // 注释\ndns-server = system, 1.1.1.1\nproxy-test-url = https://example.test/204\n[Host]\nExample.test = "server:1.1.1.1"';
    const parsed = parseIniBase(text);
    expect(parsed).toEqual({ general: { ipv6: false, 'test-timeout': 0, 'dns-server': ['system', '1.1.1.1'], 'proxy-test-url': 'https://example.test/204' }, host: { 'Example.test': 'server:1.1.1.1' } });
    expect(parseIniBase(stringifyIniBase(parsed))).toEqual(parsed);
  });
  it('引号内的注释符、逗号和转义保持原样，原型属性不污染对象', () => {
    const base = { general: { example: 'a, "b" \\ # ; // c', ['__proto__']: 'example' } };
    const parsed = parseIniBase(stringifyIniBase(base));
    expect(parsed).toEqual(base);
    expect(Object.getPrototypeOf(parsed.general)).toBe(null);
  });
  it.each(['[General]\nIPV6=true\nipv6=false', '[Proxy]\na=direct', '[General]\na="unfinished', '[Host]\na=1\na=2'])('拒绝重复字段、路由段或畸形引号：%s', text => expect(() => parseIniBase(text)).toThrow());
});
