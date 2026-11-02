import type { Client, ProxyIR } from '../types.ts';
import type { Report } from '../report.ts';

/** Clash 方言共用带宽单位换算；标准化别名时比较实际数值。 */
export function bandwidthMbps(value: unknown): number | undefined {
  const match = /^(\d+(?:\.\d+)?)\s*(?:(k|m|g)bps)?$/i.exec(String(value).trim());
  if (!match) return undefined;
  const speed = Number(match[1]) * (match[2]?.toLowerCase() === 'g' ? 1000 : match[2]?.toLowerCase() === 'k' ? 0.001 : 1);
  return Number.isFinite(speed) ? speed : undefined;
}

/** 同时处理原生 YAML、手工节点与订阅解析器的别名，不能依赖内核忽略未知字段。 */
export function nodeSemantics(node: ProxyIR, client: Client, report: Report): ProxyIR {
  const out = { ...node };
  const where = 'proxy:' + node.name;
  if (node.type === 'hysteria2' && out.auth !== undefined) {
    if (out.password !== undefined && out.password !== out.auth) report.error('proxy.auth-conflict', 'Hysteria2 的 auth 与 password 不一致', where);
    else { out.password = out.auth; delete out.auth; }
  }
  if (node.type === 'hysteria' || node.type === 'hysteria2') for (const direction of ['up', 'down']) {
    const alias = `${direction}-speed`;
    if (out[alias] === undefined) continue;
    const speed = bandwidthMbps(out[alias]);
    if (speed === undefined) report.error('proxy.bandwidth', `${alias} 带宽必须为有效 Mbps 数值`, where);
    else if (out[direction] !== undefined && bandwidthMbps(out[direction]) !== speed) report.error('proxy.bandwidth-conflict', `${direction} 与 ${alias} 带宽不一致`, where);
    else { out[direction] ??= speed; delete out[alias]; }
  }
  if (['vless', 'vmess'].includes(node.type)) {
    if (node.sni !== undefined && node.servername !== undefined && node.sni !== node.servername) {
      report.error('proxy.sni-conflict', '节点 sni 与 servername 不一致，请保留一个服务器名称', where);
    } else if (node.sni !== undefined) { out.servername = node.sni; delete out.sni; }
  }
  if (client === 'mihomo' && out['block-quic'] !== undefined) {
    const block = out['block-quic'];
    if (block !== false && block !== 'off') report.error('proxy.block-quic-unsupported', client + ' 未适配节点级 block-quic；无法等价替换为全局 UDP 443 拒绝规则，请明确移除此选项或使用支持的客户端', where);
    delete out['block-quic'];
  }
  return out;
}
