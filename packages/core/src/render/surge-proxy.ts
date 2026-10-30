// 字段映射参考 Sub-Store surge producer 与 Surge 官方 Policies 文档；独立实现，不引入上游运行时。
import type { Report } from '../report.ts';
import { iniName, iniValue } from './ini-format.ts';

type Node = Record<string, unknown>;
const record = (v: unknown): Node => v && typeof v === 'object' && !Array.isArray(v) ? v as Node : {};

export function surgeProxyLine(node: Node, report: Report): string | undefined {
  const where = 'proxy:' + String(node.name);
  const error = (message: string) => report.error('surge.proxy', message, where);
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
    const map = (source: string, target = source, required = false, quote = false) => add(target, value(source, required), quote);
    const unsupported = (key: string) => { if (value(key) !== undefined) error('Surge 尚未适配节点参数 ' + key + '，不能静默移除'); };
    if (node['reality-opts'] !== undefined) unsupported('reality-opts');
    switch (type) {
      case 'ss': {
        map('cipher', 'encrypt-method', true); map('password', 'password', true, true);
        const plugin = value('plugin'), opts = record(value('plugin-opts'));
        if (plugin === 'obfs' || plugin === 'simple-obfs') {
          add('obfs', opts.mode); add('obfs-host', opts.host); add('obfs-uri', opts.uri);
          for (const k of Object.keys(opts)) if (!['mode', 'host', 'uri'].includes(k)) error('Surge 尚未适配混淆参数 ' + k);
        } else if (plugin !== undefined) error('Surge 尚未适配该 Shadowsocks 插件');
        break;
      }
      case 'vmess':
        map('uuid', 'username', true);
        { const cipher = value('cipher');
          if (cipher !== undefined && cipher !== 'auto') {
            if (!['aes-128-gcm', 'chacha20-poly1305', 'chacha20-ietf-poly1305'].includes(String(cipher))) error('Surge VMess 不支持此加密方式');
            add('encrypt-method', cipher === 'chacha20-poly1305' ? 'chacha20-ietf-poly1305' : cipher);
          }
        }
        map('tls'); add('vmess-aead', true);
        if (Number(value('alterId') ?? 0) !== 0) error('Surge VMess 仅支持 alterId=0');
        break;
      case 'trojan': case 'anytls':
        map('password', 'password', true, true);
        if (value('tls') === false) error('此协议不能关闭 TLS');
        break;
      case 'http': case 'socks5':
        if (value('tls') === true) fields[0] = type === 'http' ? 'https' : 'socks5-tls';
        map('username'); map('password', 'password', false, true);
        break;
      case 'snell': {
        map('psk', 'psk', true, true); map('version');
        const obfs = record(value('obfs-opts'));
        add('obfs', obfs.mode); add('obfs-host', obfs.host);
        for (const k of Object.keys(obfs)) if (!['mode', 'host'].includes(k)) error('Surge 尚未适配 Snell 混淆参数 ' + k);
        break;
      }
      case 'tuic':
        fields[0] = node.uuid !== undefined ? 'tuic-v5' : 'tuic';
        if (node.uuid !== undefined) { map('uuid', 'uuid', true); map('password', 'password', true, true); }
        else map('token', 'token', true, true);
        map('ecn');
        break;
      case 'hysteria2': {
        map('password', 'password', true, true);
        const obfs = value('obfs');
        if (obfs !== undefined && obfs !== 'salamander') error('Surge Hysteria2 仅适配 salamander 混淆');
        if (node['obfs-password'] !== undefined && !obfs) error('混淆密码需要同时指定 salamander 混淆');
        map('obfs-password', 'salamander-password', obfs === 'salamander', true);
        const down = value('down');
        if (down !== undefined) add('download-bandwidth', bandwidthMbps(down));
        if (value('up') !== undefined) report.warn('surge.bandwidth', 'Surge Hysteria2 不输出上传带宽限制', where);
        map('ecn');
        break;
      }
      default:
        error('Surge 尚未适配协议 ' + type); return undefined;
    }
    if (type === 'hysteria2' || type === 'tuic') {
      const ports = value('ports');
      if (ports !== undefined) {
        if (node['dialer-proxy']) error('Surge 端口跳跃不能与代理链同时使用');
        add('port-hopping', String(ports).replace(/,/g, ';'), true);
      }
      map('hop-interval', 'port-hopping-interval');
    }
    const network = value('network');
    if (network !== undefined && network !== 'tcp') {
      if (type !== 'vmess' || network !== 'ws') error('Surge 该协议不支持当前传输方式 ' + String(network));
      else {
        add('ws', true);
        const ws = record(value('ws-opts'));
        add('ws-path', ws.path);
        const headers = record(ws.headers);
        if (Object.keys(headers).length) add('ws-headers', Object.entries(headers).map(([k, v]) => {
          if (/[|:\r\n]/.test(k) || /[|\r\n]/.test(String(v))) throw new Error('WebSocket 请求头不能包含分隔符或换行');
          return k + ':' + String(v);
        }).join('|'), true);
        for (const k of Object.keys(ws)) if (!['path', 'headers'].includes(k)) error('Surge 尚未适配 WebSocket 参数 ' + k);
      }
    }
    const sni = value('sni'), servername = value('servername');
    if (sni !== undefined && servername !== undefined && sni !== servername) error('节点 sni 与 servername 不一致');
    add('sni', sni ?? servername);
    const alpn = value('alpn'); if (alpn !== undefined) add('alpn', Array.isArray(alpn) ? alpn.map(v => iniValue(v)).join(',') : alpn, true);
    for (const [source, target] of [['udp','udp-relay'], ['tfo','tfo'], ['skip-cert-verify','skip-cert-verify'], ['dialer-proxy','underlying-proxy'], ['interface-name','interface'], ['test-url','test-url'], ['test-timeout','test-timeout'], ['block-quic','block-quic']]) map(source!, target!);
    const ipVersion = value('ip-version');
    if (ipVersion !== undefined) {
      const mapping: Record<string, string> = { dual: 'dual', ipv4: 'v4-only', ipv6: 'v6-only', 'ipv4-prefer': 'prefer-v4', 'ipv6-prefer': 'prefer-v6' };
      if (!mapping[String(ipVersion)]) error('Surge 无法转换 ip-version');
      else add('ip-version', mapping[String(ipVersion)]);
    }
    map('fingerprint', 'server-cert-fingerprint-sha256');
    if (value('client-fingerprint') !== undefined) report.warn('surge.fingerprint', 'Surge 不提供相同的 ClientHello 指纹选择，已省略 client-fingerprint', where);
    for (const key of Object.keys(node)) if (!key.startsWith('_') && !used.has(key)) error('Surge 尚未适配节点参数 ' + key + '，请在处理链中移除或改写');
    return name + ' = ' + fields.join(', ');
  } catch (cause) { error(cause instanceof Error ? cause.message : '节点格式错误'); return undefined; }
}

export function bandwidthMbps(value: unknown): number {
  const match = /^(\d+(?:\.\d+)?)\s*(?:(k|m|g)bps)?$/i.exec(String(value).trim());
  if (!match) throw new Error('带宽需要 Mbps 数值或带 Kbps / Mbps / Gbps 单位');
  return Number(match[1]) * (match[2]?.toLowerCase() === 'g' ? 1000 : match[2]?.toLowerCase() === 'k' ? 0.001 : 1);
}
