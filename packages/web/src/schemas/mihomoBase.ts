import { getPath, isRecord, setPath, type FieldGroup, type FieldSpec } from '../components/schema.ts';
import { mihomoBasePlaceholders } from './placeholders.ts';

const field = (key: keyof typeof mihomoBasePlaceholders, type: FieldSpec['type'], options?: string[]): FieldSpec => ({
  key, label: key, type, placeholder: mihomoBasePlaceholders[key], ...(options ? { options } : {}),
  ...(type === 'lines' ? { hint: '每行一项' } : {}),
});

export const mihomoBaseGroups: FieldGroup[] = [
  { title: '通用', fields: [
    field('mixed-port', 'number'), field('port', 'number'), field('socks-port', 'number'),
    field('allow-lan', 'bool'), field('bind-address', 'string'), field('mode', 'enum', ['rule', 'global', 'direct']),
    field('log-level', 'enum', ['silent', 'error', 'warning', 'info', 'debug']), field('ipv6', 'bool'),
    field('unified-delay', 'bool'), field('tcp-concurrent', 'bool'),
    field('find-process-mode', 'enum', ['always', 'strict', 'off']), field('global-client-fingerprint', 'string'),
    field('profile.store-selected', 'bool'), field('profile.store-fake-ip', 'bool'),
  ] },
  { title: '外部控制', fields: [
    field('external-controller', 'string'), field('external-ui', 'string'), field('secret', 'string'),
  ] },
  { title: 'DNS', fields: [
    field('dns.enable', 'bool'), field('dns.listen', 'string'), field('dns.ipv6', 'bool'),
    field('dns.enhanced-mode', 'enum', ['fake-ip', 'redir-host']), field('dns.fake-ip-range', 'string'),
    field('dns.fake-ip-filter', 'lines'), field('dns.default-nameserver', 'lines'), field('dns.nameserver', 'lines'),
    field('dns.fallback', 'lines'), field('dns.fallback-filter.geoip', 'bool'), field('dns.fallback-filter.geoip-code', 'string'),
    { ...field('dns.nameserver-policy', 'kv'), keyPlaceholder: '匹配的域名、通配符或 geosite 条件', valuePlaceholder: '指定的 DNS 地址，多个用逗号分隔', hint: '多个服务器用逗号分隔，保存为列表；单个服务器保存为字符串' },
    field('dns.proxy-server-nameserver', 'lines'), field('dns.direct-nameserver', 'lines'), field('dns.respect-rules', 'bool'),
  ] },
  { title: '嗅探', fields: [
    field('sniffer.enable', 'bool'), field('sniffer.force-dns-mapping', 'bool'),
    field('sniffer.parse-pure-ip', 'bool'), field('sniffer.override-destination', 'bool'),
  ] },
  { title: 'TUN', fields: [
    field('tun.enable', 'bool'), field('tun.stack', 'enum', ['system', 'gvisor', 'mixed', 'mips']),
    field('tun.auto-route', 'bool'), field('tun.auto-detect-interface', 'bool'), field('tun.strict-route', 'bool'),
    field('tun.dns-hijack', 'lines'), field('tun.mtu', 'number'),
  ] },
  { title: 'GEO 数据', fields: [
    field('geodata-mode', 'bool'), field('geo-auto-update', 'bool'), field('geo-update-interval', 'number'),
    field('geox-url.geoip', 'string'), field('geox-url.geosite', 'string'), field('geox-url.mmdb', 'string'),
  ] },
];

const policyPath = 'dns.nameserver-policy';
const displayPolicy = (value: unknown) => Array.isArray(value) ? value.join(', ') : value;

/** 公共 kv 输入只接收字符串；转换仅用于表单，原始 YAML 仍直接读写配置。 */
export function baseToForm(value: Record<string, unknown>): Record<string, unknown> {
  const policy = getPath(value, policyPath);
  return isRecord(policy) ? setPath(value, policyPath, Object.fromEntries(
    Object.entries(policy).map(([key, item]) => [key, displayPolicy(item)]),
  )) : value;
}

export function baseFromForm(value: Record<string, unknown>, previous: Record<string, unknown>, inherited: Record<string, unknown> = {}): Record<string, unknown> {
  const policy = getPath(value, policyPath);
  if (!isRecord(policy)) return value;
  const previousPolicy = getPath(previous, policyPath);
  const inheritedPolicy = getPath(inherited, policyPath);
  const old = { ...(isRecord(inheritedPolicy) ? inheritedPolicy : {}), ...(isRecord(previousPolicy) ? previousPolicy : {}) };
  return setPath(value, policyPath, Object.fromEntries(Object.entries(policy).map(([key, item]) => {
    // 未编辑的单元素数组和包含逗号的原始字符串不能因编辑其他字段而改变类型。
    if (isRecord(old) && Object.hasOwn(old, key) && item === displayPolicy(old[key])) return [key, old[key]];
    return [key, typeof item === 'string' && item.includes(',') ? item.split(',').map((part) => part.trim()) : item];
  })));
}
