import type { Client, ProxyIR } from '../types.ts';
import type { Report } from '../report.ts';

/** 同时处理原生 YAML、手工节点与订阅解析器的别名，不能依赖内核忽略未知字段。 */
export function nodeSemantics(node: ProxyIR, client: Client, report: Report): ProxyIR {
  const out = { ...node };
  const where = 'proxy:' + node.name;
  if (['vless', 'vmess'].includes(node.type)) {
    if (node.sni !== undefined && node.servername !== undefined && node.sni !== node.servername) {
      report.error('proxy.sni-conflict', '节点 sni 与 servername 不一致，请保留一个服务器名称', where);
    } else if (node.sni !== undefined) { out.servername = node.sni; delete out.sni; }
  }
  if (['mihomo', 'stash'].includes(client) && out['block-quic'] !== undefined) {
    const block = out['block-quic'];
    if (block !== false && block !== 'off') report.error('proxy.block-quic-unsupported', client + ' 未适配节点级 block-quic；无法等价替换为全局 UDP 443 拒绝规则，请明确移除此选项或使用支持的客户端', where);
    delete out['block-quic'];
  }
  return out;
}
