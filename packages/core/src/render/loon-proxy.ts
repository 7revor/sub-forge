// 按 Loon 官方节点语法独立映射，参考 Sub-Store producer 的参数对应关系。
import type { Report } from '../report.ts';
import { iniName, iniValue } from './ini-format.ts';
import { bandwidthMbps } from './surge-proxy.ts';

type Fields = Record<string, unknown>;
const record = (value: unknown): Fields => {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('节点嵌套参数必须是对象');
  return value as Fields;
};
const IP_MODES: Record<string, string> = { dual: 'dual', ipv4: 'v4-only', ipv6: 'v6-only', 'ipv4-prefer': 'prefer-v4', 'ipv6-prefer': 'prefer-v6' };

export function loonProxyLine(node: Fields, report: Report): string | undefined {
  const where = 'proxy:' + String(node.name);
  const error = (message: string) => report.error('loon.proxy', message, where);
  try {
    const name = iniName(node.name), type = String(node.type);
    if (typeof node.server !== 'string' || !node.server || !Number.isInteger(node.port) || Number(node.port) < 1 || Number(node.port) > 65535) throw new Error('节点服务器或端口不合法');
    const fields = [type, iniValue(node.server), String(node.port)];
    const used = new Set(['name', 'type', 'server', 'port', 'upstreamDialer']);
    const value = (key: string, required = false) => {
      used.add(key);
      const v = node[key];
      if (required && (v === undefined || v === '')) throw new Error('节点缺少 ' + key);
      return v;
    };
    const add = (key: string, v: unknown, quote = false) => { if (v !== undefined) fields.push(key + '=' + iniValue(v, quote)); };
    const map = (source: string, target = source, quote = false) => add(target, value(source), quote);
    const nested = (opts: Fields, mapping: Record<string, string>) => {
      for (const [key, v] of Object.entries(opts)) {
        const target = mapping[key];
        if (!target) error('Loon 尚未适配嵌套参数 ' + key);
        else add(target, v);
      }
    };
    switch (type) {
      case 'ss': case 'ssr': {
        fields[0] = type === 'ss' ? 'Shadowsocks' : 'ShadowsocksR';
        fields.push(iniValue(value('cipher', true)), iniValue(value('password', true), true));
        if (type === 'ssr') for (const key of ['protocol', 'protocol-param', 'obfs', 'obfs-param']) map(key);
        const plugin = value('plugin'), opts = record(value('plugin-opts'));
        if (plugin === 'obfs' || plugin === 'simple-obfs') nested(opts, { mode: 'obfs-name', host: 'obfs-host', uri: 'obfs-uri' });
        else if (plugin === 'shadow-tls') nested(opts, { password: 'shadow-tls-password', host: 'shadow-tls-sni', version: 'shadow-tls-version' });
        else if (plugin !== undefined || Object.keys(opts).length) error('Loon 尚未适配该 Shadowsocks 插件');
        map('udp-over-tcp'); map('udp-port');
        break;
      }
      case 'vmess': {
        const cipher = value('cipher') ?? 'auto';
        const mapped = cipher === 'chacha20-poly1305' ? 'chacha20-ietf-poly1305' : cipher;
        if (!['none', 'auto', 'aes-128-cfb', 'aes-128-gcm', 'chacha20-ietf-poly1305'].includes(String(mapped))) error('Loon VMess 不支持此加密方式');
        fields.push(iniValue(mapped), iniValue(value('uuid', true), true));
        add('alterId', value('alterId') ?? 0); map('tls', 'over-tls');
        break;
      }
      case 'vless':
        fields.push(iniValue(value('uuid', true), true)); map('tls', 'over-tls');
        if (node.flow !== undefined && node.flow !== 'xtls-rprx-vision') error('Loon 不支持此 VLESS flow');
        map('flow');
        break;
      case 'trojan': case 'anytls':
        fields.push(iniValue(value('password', true), true));
        if (value('tls') === false) error('此协议不能关闭 TLS');
        if (type === 'anytls') { map('idle-session-timeout'); map('max-stream-count'); }
        break;
      case 'http': case 'socks5': {
        const username = value('username'), password = value('password');
        if (username !== undefined || password !== undefined) fields.push(iniValue(username ?? '', true), iniValue(password ?? '', true));
        if (type === 'http') { if (value('tls') === true) fields[0] = 'https'; map('always-use-connect'); }
        else map('tls', 'over-tls');
        break;
      }
      case 'hysteria2': {
        fields.push(iniValue(value('password', true), true));
        const obfs = value('obfs');
        if (obfs !== undefined && obfs !== 'salamander') error('Loon Hysteria2 仅适配 salamander 混淆');
        if (node['obfs-password'] !== undefined && !obfs) error('混淆密码需要同时指定 salamander 混淆');
        add('salamander-password', value('obfs-password', obfs === 'salamander'), true);
        const ports = value('ports'); if (ports !== undefined) add('server-ports', String(ports).replace(/-/g, ':'), true);
        map('hop-interval');
        const down = value('down'); if (down !== undefined) add('download-bandwidth', bandwidthMbps(down));
        if (value('up') !== undefined) report.warn('loon.bandwidth', 'Loon Hysteria2 不输出上传带宽限制', where);
        break;
      }
      default: error('Loon 尚未适配协议 ' + type); return undefined;
    }
    const network = value('network') ?? 'tcp';
    if (['vmess', 'vless', 'trojan'].includes(type)) {
      if (!(type === 'trojan' ? ['tcp', 'ws'] : ['tcp', 'ws', 'http']).includes(String(network))) error('Loon 不支持该传输方式 ' + String(network));
      else {
        add('transport', network);
        if (network !== 'tcp') {
          const opts = record(value(network === 'ws' ? 'ws-opts' : 'http-opts'));
          const one = (v: unknown) => { if (!Array.isArray(v)) return v; if (v.length !== 1) throw new Error('Loon 传输参数仅支持单个 Host 或 path'); return v[0]; };
          add('path', one(opts.path));
          const headers = record(opts.headers);
          for (const [key, v] of Object.entries(headers)) key.toLowerCase() === 'host' ? add('host', one(v)) : error('Loon 无法保留自定义传输请求头 ' + key);
          for (const key of Object.keys(opts)) if (!['path', 'headers'].includes(key)) error('Loon 尚未适配传输参数 ' + key);
        }
      }
    } else if (network !== 'tcp') error('该 Loon 协议不支持配置传输方式');
    const reality = record(value('reality-opts'));
    if (Object.keys(reality).length) {
      if (!['vmess', 'vless', 'trojan', 'anytls'].includes(type) || node.tls === false) error('该节点不能使用 Loon Reality');
      if (!reality['public-key']) error('Reality 缺少公钥');
      nested(reality, { 'public-key': 'public-key', 'short-id': 'short-id' });
    }
    const sni = value('sni'), servername = value('servername');
    if (sni !== undefined && servername !== undefined && sni !== servername) error('节点 sni 与 servername 不一致');
    add('sni', sni ?? servername);
    for (const [source, target] of [['tfo', 'fast-open'], ['udp', 'udp'], ['skip-cert-verify', 'skip-cert-verify'], ['fingerprint', 'tls-cert-sha256'], ['tls-pubkey-sha256', 'tls-pubkey-sha256']]) map(source!, target!);
    for (const key of ['alpn', 'server-dns']) { const v = value(key); if (v !== undefined) add(key, Array.isArray(v) ? v.map(x => iniValue(x)).join(',') : v, true); }
    const block = value('block-quic');
    if (block !== undefined) {
      if (![true, false, 'on', 'off'].includes(block as boolean | string)) error('Loon block-quic 必须可以转换为布尔值');
      else add('block-quic', block === true || block === 'on');
    }
    const mode = value('ip-version');
    if (mode !== undefined) {
      if (!IP_MODES[String(mode)]) error('Loon 无法转换 ip-version');
      else add('ip-mode', IP_MODES[String(mode)]);
    }
    const fingerprint = value('client-fingerprint');
    if (fingerprint !== undefined) {
      const profile = { chrome: 'chrome', safari: 'safari-ios18', ios: 'safari-ios18' }[String(fingerprint)];
      if (profile) { add('tls-profile', profile); report.info('loon.fingerprint', 'TLS 指纹映射为 Loon 的 ' + profile + '，具体握手由客户端版本决定', where); }
      else error('Loon 无法表达此客户端指纹 ' + String(fingerprint));
    }
    if (value('dialer-proxy') !== undefined) error('Loon 尚未适配代理链，不能移除前置后直接连接');
    for (const key of Object.keys(node)) if (!key.startsWith('_') && !used.has(key)) error('Loon 尚未适配节点参数 ' + key + '，请在处理链中移除或改写');
    return name + ' = ' + fields.join(', ');
  } catch (cause) { error(cause instanceof Error ? cause.message : '节点格式错误'); return undefined; }
}
