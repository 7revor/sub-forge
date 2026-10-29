import type { LocalProxy } from '../types.ts';

export type NodeIssue = { field: string; message: string };
export const TESTABLE_PROXY_TYPES = ['ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic', 'anytls', 'socks5', 'http'] as const;

/** 不重建对象：编辑与保存保留所有扩展字段；仅检查已知字段与协议的必要条件。 */
export function validateLocalProxy(value: unknown): NodeIssue[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [{ field: '', message: '需要单个节点的 YAML 映射' }];
  const p = value as LocalProxy;
  const issues: NodeIssue[] = [];
  const required = (field: string) => {
    if (typeof p[field] !== 'string' || !(p[field] as string).trim()) issues.push({ field, message: `${field} 必须是非空字符串` });
  };
  for (const key of ['name', 'type', 'server']) required(key);
  if (typeof p.server === 'string' && /[\s/]/.test(p.server)) issues.push({ field: 'server', message: 'server 需要主机名或 IP，不能包含空格或 URL 路径' });
  if (!Number.isInteger(p.port) || p.port < 1 || p.port > 65535) issues.push({ field: 'port', message: 'port 必须是 1–65535 的整数' });
  if (['ss', 'trojan', 'hysteria2', 'tuic', 'anytls'].includes(p.type)) required('password');
  if (['vmess', 'vless', 'tuic'].includes(p.type)) required('uuid');
  if (p.type === 'ss') required('cipher');
  for (const field of ['tls', 'udp', 'tfo', 'skip-cert-verify']) {
    if (p[field] !== undefined && typeof p[field] !== 'boolean') issues.push({ field, message: `${field} 必须是 true 或 false` });
  }
  for (const field of ['ws-opts', 'grpc-opts', 'reality-opts', 'plugin-opts']) {
    if (p[field] !== undefined && (!p[field] || typeof p[field] !== 'object' || Array.isArray(p[field]))) issues.push({ field, message: `${field} 必须是映射` });
  }
  for (const field of ['dialer', 'dialer-proxy', 'underlying-proxy']) {
    if (field in p) issues.push({ field, message: `${field} 请在配置订阅的「代理链」中设置` });
  }
  return issues;
}
