import { describe, expect, it } from 'vitest';
import { baseFormFromYaml, baseFromYaml, baseToYaml } from './baseYaml.ts';

describe('基础设置 YAML', () => {
  it('回表单过滤已知字段的错误类型及列表坏项，保留有效值与未知扩展', () => {
    const result = baseFormFromYaml(`mode: rule
mixed-port: wrong
allow-lan: "true"
tun: invalid
dns:
  enable: true
  nameserver: [system, 123, {bad: true}]
  nameserver-policy:
    valid: [1.1.1.1, 123]
    single: system
    wrong: false
future: {preserve: true}
`);
    expect(result.value).toEqual({ mode: 'rule', dns: { enable: true, nameserver: ['system'], 'nameserver-policy': { valid: ['1.1.1.1'], single: 'system' } }, future: { preserve: true } });
    for (const key of ['mixed-port', 'allow-lan', 'tun', 'dns.nameserver[2]', 'dns.nameserver-policy.wrong']) expect(result.notes.join()).toContain(key);
  });

  it('回表单不因嵌套 YAML 语法错误丢弃其他有效配置', () => {
    expect(baseFormFromYaml('mode: global\ndns:\n  enable: true\n  nameserver: [\n').value).toEqual({ mode: 'global', dns: { enable: true } });
  });
  it('往返保留嵌套映射、列表、空值和未知字段', () => {
    const value = { 'allow-lan': false, dns: { enable: true, 'enhanced-mode': 'fake-ip', nameserver: ['https://dns.example/dns-query'], 'nameserver-policy': { '+.example': ['1.1.1.1', '8.8.8.8'], single: 'system' } }, sniffer: { sniff: { TLS: { ports: [443] } } }, custom: { empty: {}, list: [], nil: null, zero: 0 } };
    expect(baseFromYaml(baseToYaml(value))).toEqual({ ok: true, value });
    expect(baseFromYaml(baseToYaml({}))).toEqual({ ok: true, value: {} });
  });
  it.each(['', '# 注释', 'null', 'false', '123', '文本', '- dns', '[]'])('拒绝非映射并返回行号：%s', (text) => {
    expect(baseFromYaml(text)).toMatchObject({ ok: false, error: 'YAML 顶层必须是映射', line: 1 });
  });
  it('定位非映射与语法错误所在行', () => {
    expect(baseFromYaml('# 注释\n\n- dns')).toMatchObject({ ok: false, line: 3 });
    expect(baseFromYaml('dns:\n  enable: [')).toMatchObject({ ok: false, line: 2 });
    expect(baseFromYaml('dns: true\ndns: false')).toMatchObject({ ok: false, line: 2 });
  });
});
