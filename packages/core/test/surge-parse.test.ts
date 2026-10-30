import { describe, expect, it } from 'vitest';
import { parseSurgeLine } from '../src/proxy/surge.ts';
import { surgeProxyLine } from '../src/render/surge-proxy.ts';
import { Report } from '../src/report.ts';

describe('Surge 节点往返转换', () => {
  it.each([
    { name: 'HY2', type: 'hysteria2', password: 'a,b="c"\\d', obfs: 'salamander', 'obfs-password': 'example', ports: '20000-20100,30000', 'hop-interval': 30, down: '100 Mbps', ecn: false, sni: 'cdn.example.test', alpn: ['h3'], udp: false, tfo: false, 'skip-cert-verify': false },
    { name: 'VMess', type: 'vmess', uuid: 'example', alterId: 0, cipher: 'chacha20-poly1305', tls: true, network: 'ws', 'ws-opts': { path: '/ws,a', headers: { Host: 'cdn.example.test' } }, servername: 'cdn.example.test', 'dialer-proxy': '前置', 'ip-version': 'ipv4-prefer', 'test-url': 'http://example.test/204', 'test-timeout': 1.5 },
    { name: 'HTTP', type: 'http', username: 'a=b', password: ' a,b="c" ', tls: true },
    { name: 'SS', type: 'ss', password: 'example', cipher: 'aes-128-gcm', plugin: 'obfs', 'plugin-opts': { mode: 'http', host: 'cdn.example.test', uri: '/example' } },
  ])('$name 输出后重新导入保留凭据和已适配字段', input => {
    const node = { server: 'node.example.test', port: 443, ...input };
    const report = new Report(), line = surgeProxyLine(node, report);
    expect(report.hasErrors, JSON.stringify(report.items)).toBe(false);
    expect(parseSurgeLine(line!)).toEqual(node);
  });
  it('位置凭据含等号、注释和 URL 的分隔符不会损坏参数', () => {
    expect(parseSurgeLine('H = https, example.test, 443, "a=b", " p,#;// ", tfo=false // 注释')).toMatchObject({ username: 'a=b', password: ' p,#;// ', tfo: false });
  });
  it.each([
    'A = trojan, example.test, 443, password=x, unknown=1',
    'A = trojan, example.test, 443, password=x, udp-relay=maybe',
    'A = trojan, example.test, 443, password=x, password=y',
    'A = vmess, example.test, 443, username=x, vmess-aead=false',
    'A = vmess, example.test, 443, username=x',
  ])('不能丢参数后假装成功：%s', line => expect(() => parseSurgeLine(line)).toThrow());
});
