import type { FieldGroup, FieldSpec } from '../components/schema.ts';
import { mihomoBasePlaceholders } from './placeholders.ts';

// 共通字段沿用 Mihomo 解释，Stash 独有字段按其配置含义单独说明。
const placeholders = {
  ...mihomoBasePlaceholders,
  'dns.skip-cert-verify': '是否跳过加密 DNS 服务器的证书校验',
  'dns.fake-ip-filter': '需要返回真实 IP 的域名，每行一项',
  'http.force-http-engine': '强制交给 HTTP 引擎处理的主机，每行一项',
  'http.mitm': '需要解密 HTTPS 的主机名，每行一项',
  'http.ca': '用于 HTTPS 解密的 CA 证书内容',
  'http.ca-passphrase': '解密 CA 证书使用的密码',
};
const field = (key: keyof typeof placeholders, type: FieldSpec['type'], options?: string[]): FieldSpec => ({ key, label: key, type, placeholder: placeholders[key], ...(options ? { options } : {}), ...(type === 'lines' ? { hint: '每行一项' } : {}) });

/** 仅展示 Stash 官方配置样例确认的字段，其余原生字段可在原始 YAML 中编辑。 */
export const stashBaseGroups: FieldGroup[] = [
  { title: '通用', fields: [field('mode', 'enum', ['rule', 'global', 'direct']), field('log-level', 'enum', ['silent', 'error', 'warning', 'info', 'debug'])] },
  { title: 'DNS', fields: [field('dns.default-nameserver', 'lines'), field('dns.nameserver', 'lines'), field('dns.skip-cert-verify', 'bool'), field('dns.fake-ip-filter', 'lines'), { ...field('dns.nameserver-policy', 'kv'), keyPlaceholder: '需要指定 DNS 的域名匹配条件', valuePlaceholder: '指定的 DNS 地址，多个用逗号分隔', hint: '多个服务器用逗号分隔' }] },
  { title: 'HTTP 引擎', fields: [field('http.force-http-engine', 'lines'), field('http.mitm', 'lines'), field('http.ca', 'string'), field('http.ca-passphrase', 'string')] },
];
