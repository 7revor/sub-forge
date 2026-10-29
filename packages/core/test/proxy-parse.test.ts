import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { encodeBase64 } from '../src/util/base64.ts';
import { parseContent } from '../src/proxy/parse.ts';
import { proxyKey } from '../src/proxy/key.ts';
import type { NodeSetID } from '../src/types.ts';

const SRC: NodeSetID = { type: 'source', id: 'src_a' };

/** 去掉隐式字段，便于断言输出内容 */
const strip = (p: Record<string, unknown>) => Object.fromEntries(Object.entries(p).filter(([k]) => !k.startsWith('_')));

describe('URI 列表', () => {
  it('解析主流协议，单个失败不中断', () => {
    const vmessJson = JSON.stringify({ v: '2', ps: '日本 05 [原生]', add: 'jp.example.com', port: '443', id: 'u-1', aid: '0', net: 'ws', path: '/ray', host: 'cdn.example.com', tls: 'tls', sni: 'jp.example.com' });
    const text = [
      `ss://${encodeBase64('aes-128-gcm:pass')}@hk.example.com:8388#${encodeURIComponent('香港 01 | 0.5x')}`,
      `ss://${encodeBase64('chacha20-ietf-poly1305:p2@sg.example.com:443')}#SG`,
      `vmess://${encodeBase64(vmessJson)}`,
      'vless://uuid-2@us.example.com:443?security=reality&sni=www.apple.com&fp=chrome&pbk=PUBKEY&sid=ab&flow=xtls-rprx-vision&type=tcp#US%20Reality',
      'trojan://pw@tw.example.com:443?sni=tw.example.com&allowInsecure=1&type=grpc&serviceName=svc#TW',
      'hysteria2://auth@[2001:db8::1]:8443?sni=h.example.com&obfs=salamander&obfs-password=op#Hy2',
      'tuic://u3:p3@t.example.com:443?congestion_control=bbr&alpn=h3&sni=t.example.com#TUIC',
      'ssr://abcdef',
      'not a proxy',
    ].join('\n');
    const r = parseContent(text, SRC);
    expect(r.format).toBe('uri');
    expect(r.proxies.map((p) => strip(p))).toMatchSnapshot();
    expect(r.failures.map((f) => f.reason)).toEqual(['暂不支持的 URI 协议 ssr', '不是 URI']);
  });

  it('Base64 包裹的订阅', () => {
    const inner = `trojan://pw@a.example.com:443#A\ntrojan://pw@b.example.com:443#B`;
    const r = parseContent(encodeBase64(inner), SRC);
    expect(r.format).toBe('base64');
    expect(r.proxies.map((p) => p.name)).toEqual(['A', 'B']);
  });
});

describe('Clash YAML', () => {
  const reality = {
    name: '🇺🇸 Reality 测试', server: 'us.example.com', port: 443, type: 'vless',
    uuid: '00000000-0000-4000-8000-000000000001', tls: true, flow: 'xtls-rprx-vision',
    'reality-opts': { 'public-key': 'test-public-key', 'short-id': '01234567' },
    servername: 'www.example.com', 'client-fingerprint': 'chrome', network: 'tcp', udp: true,
  };

  it.each([
    ['单节点映射', stringify(reality)],
    ['整体缩进的单节点映射', stringify(reality).split('\n').map((line) => `    ${line}`).join('\n')],
    ['带注释的节点列表', `# 本地节点\n${stringify([reality])}`],
    ['proxies 外层', stringify({ proxies: [reality] })],
    ['行内单节点映射', JSON.stringify(reality)],
    ['行内节点列表', JSON.stringify([reality])],
    ['行内 proxies 外层', JSON.stringify({ proxies: [reality] })],
  ])('识别%s，完整保留 Reality 字段', (_name, text) => {
    const r = parseContent(text, { type: 'local', id: 'paste' });
    expect(r.format).toBe('clash');
    expect(r.failures).toEqual([]);
    expect(r.proxies.map(strip)).toEqual([reality]);
  });

  it('裸节点列表逐项校验，坏节点不影响其余节点', () => {
    const r = parseContent(stringify([reality, { name: '缺少服务器', type: 'vless' }, { ...reality, name: '第二个节点' }]), SRC);
    expect(r.format).toBe('clash');
    expect(r.proxies.map((p) => p.name)).toEqual([reality.name, '第二个节点']);
    expect(r.failures).toEqual([{ line: JSON.stringify({ name: '缺少服务器', type: 'vless' }), reason: '缺少 name / type / server / port' }]);
  });

  it.each([
    'name: [未闭合\ntype: vless',
    '- name: [未闭合\n  type: vless',
    'proxies:\n  - name: [未闭合',
    'name: 重复\nname: 键\ntype: vless',
    'proxies: 不是列表',
  ])('拒绝无效 YAML，保留订阅解析的失败行为：%s', (text) => {
    expect(() => parseContent(text, SRC)).toThrow();
  });

  it('保留字段，剥离 dialer-proxy 为 upstreamDialer', () => {
    const text = `
proxies:
  - { name: JP-Relay-in, type: ss, server: 1.2.3.4, port: 443, cipher: aes-128-gcm, password: x, dialer-proxy: SG-Relay }
  - { name: SG-Relay, type: snell, server: 5.6.7.8, port: 4000, psk: k, version: 4 }
  - { name: bad, type: ss }
proxy-groups: []
`;
    const r = parseContent(text, SRC);
    expect(r.format).toBe('clash');
    expect(r.proxies).toHaveLength(2);
    expect(r.proxies[0]!.upstreamDialer).toBe('SG-Relay');
    expect(r.proxies[0]).not.toHaveProperty('dialer-proxy');
    expect(r.proxies[1]!.psk).toBe('k');
    expect(r.failures).toHaveLength(1);
  });
});

describe('Surge [Proxy]', () => {
  it('解析完整配置中的 [Proxy] 段，跳过内置策略', () => {
    const text = `[General]
loglevel = notify

[Proxy]
DIRECT = direct
HK = ss, hk.example.com, 8388, encrypt-method=aes-128-gcm, password=p, obfs=http, obfs-host=bing.com, udp-relay=true
VM = vmess, v.example.com, 443, username=u-1, tls=true, ws=true, ws-path=/ray, ws-headers=Host:cdn.example.com, sni=v.example.com
Home = socks5, 10.0.0.2, 1080, user, pass, underlying-proxy=HK
WG = wireguard, section-name=wg0

[Proxy Group]
G = select, HK
`;
    const r = parseContent(text, SRC);
    expect(r.format).toBe('surge');
    expect(r.proxies.map((p) => strip(p))).toMatchSnapshot();
    expect(r.failures.map((f) => f.reason)).toEqual(['缺少服务器或端口']);
  });

  it('没有段标题的纯节点行也能识别', () => {
    const r = parseContent('A = trojan, a.example.com, 443, password=x\nB = hysteria2, b.example.com, 443, password=y', SRC);
    expect(r.format).toBe('surge');
    expect(r.proxies.map((p) => p.type)).toEqual(['trojan', 'hysteria2']);
  });
});

describe('隐式字段', () => {
  it('_key 与名称无关，与凭据有关', () => {
    const a = parseContent('trojan://pw@a.example.com:443#香港 01', SRC).proxies[0]!;
    const b = parseContent('trojan://pw@a.example.com:443#🇭🇰 HK-01', SRC).proxies[0]!;
    const c = parseContent('trojan://other@a.example.com:443#香港 01', SRC).proxies[0]!;
    expect(a._key).toBe(b._key);
    expect(a._key).not.toBe(c._key);
    expect(a._origName).toBe('香港 01');
    expect(a._source).toEqual(SRC);
    expect(a._key).toBe(proxyKey({ type: 'trojan', server: 'a.example.com', port: 443, password: 'pw' }));
  });
});
