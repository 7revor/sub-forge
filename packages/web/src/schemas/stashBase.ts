import type { FieldGroup, FieldSpec } from '../components/schema.ts';
const field = (key: string, type: FieldSpec['type'], options?: string[]): FieldSpec => ({ key, label: key, type, ...(options ? { options } : {}), ...(type === 'lines' ? { hint: '每行一项' } : {}) });

/** 仅展示 Stash 官方配置样例确认的字段，其余原生字段可在原始 YAML 中编辑。 */
export const stashBaseGroups: FieldGroup[] = [
  { title: '通用', fields: [field('mode', 'enum', ['rule', 'global', 'direct']), field('log-level', 'enum', ['silent', 'error', 'warning', 'info', 'debug'])] },
  { title: 'DNS', fields: [field('dns.default-nameserver', 'lines'), field('dns.nameserver', 'lines'), field('dns.skip-cert-verify', 'bool'), field('dns.fake-ip-filter', 'lines'), { ...field('dns.nameserver-policy', 'kv'), hint: '多个服务器用逗号分隔' }] },
  { title: 'HTTP 引擎', fields: [field('http.force-http-engine', 'lines'), field('http.mitm', 'lines'), field('http.ca', 'string'), field('http.ca-passphrase', 'string')] },
];
