import { describe, expect, it } from 'vitest';
import { parseClientProxyObject } from '../src/proxy/clientJson.ts';

const identity = { name: 'Reality 测试', type: 'vless', server: 'example.com', port: 443, uuid: 'test-uuid', flow: 'xtls-rprx-vision' };
const expected = { ...identity, tls: true, servername: 'www.example.com', 'client-fingerprint': 'chrome', 'reality-opts': { 'public-key': 'test-public-key', 'short-id': '00123456' } };
const sing = {
  type: 'vless', tag: identity.name, server: identity.server, server_port: 443, uuid: identity.uuid, flow: identity.flow,
  tls: { enabled: true, server_name: 'www.example.com', utls: { enabled: true, fingerprint: 'chrome' }, reality: { enabled: true, public_key: 'test-public-key', short_id: '00123456' } },
};
const xray = {
  tag: identity.name, protocol: 'vless',
  settings: { vnext: [{ address: identity.server, port: 443, users: [{ id: identity.uuid, encryption: 'none', flow: identity.flow }] }] },
  streamSettings: { network: 'tcp', security: 'reality', realitySettings: { serverName: 'www.example.com', fingerprint: 'chrome', publicKey: 'test-public-key', shortId: '00123456' } },
};

describe('客户端 JSON 节点转换', () => {
  it('sing-box Reality 保留 TLS、指纹和前导零短 ID', () => {
    expect(parseClientProxyObject(sing)).toEqual({ ...expected, udp: true });
  });

  it('Xray / V2Ray 传统 vnext 与新单服务器格式一致', () => {
    expect(parseClientProxyObject(xray)).toEqual(expected);
    expect(parseClientProxyObject({ ...xray, settings: { address: identity.server, port: 443, id: identity.uuid, encryption: 'none', flow: identity.flow } })).toEqual(expected);
  });

  it('VMess 分享 JSON 使用既有 URI 转换，保留 WS 和 TLS', () => {
    expect(parseClientProxyObject({ v: '2', ps: 'VMess', add: 'example.com', port: '443', id: 'test-uuid', aid: '0', net: 'ws', path: '/ws', host: 'cdn.example.com', tls: 'tls', sni: 'www.example.com' })).toEqual({
      name: 'VMess', type: 'vmess', server: 'example.com', port: 443, uuid: 'test-uuid', alterId: 0, cipher: 'auto',
      tls: true, servername: 'www.example.com', network: 'ws', 'ws-opts': { path: '/ws', headers: { Host: 'cdn.example.com' } },
    });
  });

  it('sing-box 的 network 控制 UDP，transport 独立控制 WS', () => {
    expect(parseClientProxyObject({ ...sing, network: 'tcp', transport: { type: 'ws', path: '/socket', headers: { Host: 'cdn.example.com' }, max_early_data: 2048, early_data_header_name: 'Sec-WebSocket-Protocol' } })).toEqual({
      ...expected, udp: false, network: 'ws', 'ws-opts': { path: '/socket', headers: { Host: 'cdn.example.com' }, 'max-early-data': 2048, 'early-data-header-name': 'Sec-WebSocket-Protocol' },
    });
  });

  it('Xray gRPC 与新 method 字段', () => {
    expect(parseClientProxyObject({ ...xray, streamSettings: { ...xray.streamSettings, network: undefined, method: 'grpc', grpcSettings: { serviceName: 'test-service' } } })).toEqual({ ...expected, network: 'grpc', 'grpc-opts': { 'grpc-service-name': 'test-service' } });
  });

  it.each([
    ['shadowsocks', { method: 'aes-128-gcm', password: 'test' }, { type: 'ss', cipher: 'aes-128-gcm', password: 'test' }],
    ['vmess', { uuid: 'test' }, { type: 'vmess', uuid: 'test', alterId: 0, cipher: 'auto' }],
    ['trojan', { password: 'test' }, { type: 'trojan', password: 'test' }],
    ['hysteria2', { password: 'test', obfs: { type: 'salamander', password: 'obfs-test' } }, { type: 'hysteria2', password: 'test', obfs: 'salamander', 'obfs-password': 'obfs-test' }],
    ['tuic', { uuid: 'test', password: 'test', congestion_control: 'bbr' }, { type: 'tuic', uuid: 'test', password: 'test', 'congestion-controller': 'bbr' }],
    ['anytls', { password: 'test' }, { type: 'anytls', password: 'test' }],
    ['socks', { username: 'user', password: 'test', version: '5' }, { type: 'socks5', username: 'user', password: 'test' }],
    ['http', { username: 'user', password: 'test' }, { type: 'http', username: 'user', password: 'test' }],
  ])('转换 sing-box %s 的认证字段', (type, fields, output) => {
    expect(parseClientProxyObject({ type, tag: '节点', server: 'example.com', server_port: 443, ...fields })).toEqual({ name: '节点', server: 'example.com', port: 443, udp: true, ...output });
  });

  it('Xray Trojan 服务器认证', () => {
    expect(parseClientProxyObject({ protocol: 'trojan', settings: { servers: [{ address: 'example.com', port: 443, password: 'test' }] } })).toEqual({ name: 'example.com:443', type: 'trojan', server: 'example.com', port: 443, password: 'test' });
  });

  it.each([
    { ...sing, multiplex: { enabled: true } },
    { ...sing, transport: { type: 'quic' } },
    { ...sing, tls: { enabled: true, ech: { enabled: true } } },
    { type: 'trojan', server: 'example.com', server_port: 443, password: 'test', tls: { enabled: false } },
    { protocol: 'trojan', settings: { servers: [{ address: 'example.com', port: 443, password: 'test' }] }, streamSettings: { security: 'none' } },
    { ...xray, streamSettings: { network: 'xhttp' } },
    { ...xray, settings: { vnext: [...xray.settings.vnext, ...xray.settings.vnext] } },
    { ...xray, settings: { vnext: [{ ...xray.settings.vnext[0], users: [{ id: 'a' }, { id: 'b' }] }] } },
    { protocol: 'wireguard', settings: {} },
  ])('不支持或多节点配置明确失败，不静默丢弃连接参数', (value) => {
    expect(() => parseClientProxyObject(value)).toThrow();
  });

  it('原生 Mihomo 对象交给原解析器处理', () => {
    expect(parseClientProxyObject(expected)).toBeUndefined();
  });
});
