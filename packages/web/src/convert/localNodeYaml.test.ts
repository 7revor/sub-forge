import { describe, expect, it } from 'vitest';
import { formatLocalNodeYaml, inspectLocalNodeYaml } from './localNodeYaml.ts';
import { proxyFromPaste, proxyToYaml } from './proxyYaml.ts';

const text = '# 自建节点\nname: 测试\ntype: ss\nserver: example.com\nport: 8388\ncipher: aes-128-gcm\npassword: test-password\nfuture: {nested: [1, false]}\n';
describe('单一 YAML 编辑校验', () => {
  it('格式化保留注释和扩展字段，不依赖表单恢复', () => {
    const formatted = formatLocalNodeYaml(text);
    expect(formatted).toContain('# 自建节点');
    expect(inspectLocalNodeYaml(formatted)).toEqual(inspectLocalNodeYaml(text));
    expect(inspectLocalNodeYaml(text)).toMatchObject({ ok: true, value: { future: { nested: [1, false] } } });
  });
  it.each(['0', '65536', '443.5', '"443"'])('拒绝无效端口 %s，并定位字段行', value => {
    expect(inspectLocalNodeYaml(text.replace('8388', value))).toMatchObject({ ok: false, line: 5, error: expect.stringContaining('port') });
  });
  it('已解析不等于可保存：缺失认证和布尔类型错误仍被拒绝', () => {
    expect(inspectLocalNodeYaml(text.replace('password: test-password\n', ''))).toMatchObject({ ok: false, error: expect.stringContaining('password') });
    expect(inspectLocalNodeYaml(text + 'udp: "true"\n')).toMatchObject({ ok: false, error: expect.stringContaining('udp') });
    expect(inspectLocalNodeYaml('')).toMatchObject({ ok: false });
  });
  it('语法、重复字段、多节点及循环别名不会被当成有效节点', () => {
    for (const invalid of ['name: [', text + 'port: 1234\n', `proxies:\n  - {name: A}`, '[]', text + 'cycle: &cycle {self: *cycle}\n']) expect(inspectLocalNodeYaml(invalid)).toMatchObject({ ok: false });
  });
  it('分享链接和 JSON 转换后可直接进行有效性校验', () => {
    for (const input of ['trojan://password@example.com:443#节点', '{"name":"HTTP","type":"http","server":"example.com","port":443}']) {
      const imported = proxyFromPaste(input);
      expect(imported?.ok).toBe(true);
      if (imported?.ok) expect(inspectLocalNodeYaml(proxyToYaml(imported.value))).toMatchObject({ ok: true });
    }
  });
  it('未知协议保留原始扩展字段并明确校验范围', () => {
    expect(inspectLocalNodeYaml(text.replace('type: ss', 'type: future-protocol'))).toMatchObject({ ok: true, notes: [expect.stringContaining('基础字段')] });
  });
});
