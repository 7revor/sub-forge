import type { GroupSpec } from '../types.ts';
import type { Report } from '../report.ts';
import type { MihomoRenderResult } from './mihomo.ts';
import { iniName, iniValue, stringifyIniBase } from './ini-format.ts';
import { loonProxyLine } from './loon-proxy.ts';

type Fields = Record<string, unknown>;

/** Loon 的单次测试超时只在 General 中设置；不同组要求不同时不能覆盖成最后一个。 */
export function loonBenchmarks(config: Fields, specs: GroupSpec[], report: Report): void {
  const general = { ...config.general as Fields ?? {} };
  const timeouts = specs.filter(g => g.type !== 'select' && g.test?.timeout !== undefined).map(g => g.test!.timeout! / 1000);
  if (!timeouts.length) return;
  const unique = new Set([...timeouts, ...(general['test-timeout'] !== undefined ? [general['test-timeout']] : [])]);
  if (unique.size !== 1) report.error('loon.benchmark-conflict', 'Loon 仅提供全局单次测速超时，请统一组超时与基础配置 test-timeout');
  else { general['test-timeout'] = timeouts[0]; config.general = general; }
}

function loonGroup(group: Fields, report: Report): string {
  const name = iniName(group.name), type = String(group.type);
  const fields = [type, ...[...new Set(group.proxies as string[] ?? [])].map(iniName)];
  const add = (key: string, value: unknown) => { if (value !== undefined) fields.push(key + '=' + iniValue(value)); };
  add('url', group.url);
  if (type !== 'select') {
    add('interval', group.interval);
    if (type === 'url-test') add('tolerance', group.tolerance);
    else add('max-timeout', group['max-timeout'] ?? group.timeout);
  }
  add('img-url', group.icon);
  if (type === 'load-balance' && group.strategy !== undefined) {
    const algorithm = { 'consistent-hashing': 'PCC', 'round-robin': 'Round-Robin' }[String(group.strategy)];
    if (!algorithm) report.error('loon.group-strategy', 'Loon 不支持 ' + String(group.strategy) + ' 负载均衡', 'group:' + name);
    else add('algorithm', algorithm);
  }
  for (const key of ['lazy', 'hidden']) if (group[key] !== undefined) report.warn('loon.group-option', 'Loon 尚未适配策略组参数 ' + key + '，已省略', 'group:' + name);
  for (const key of ['max-failed-times', 'expected-status']) if (group[key] !== undefined) report.error('loon.group-option', 'Loon 尚未适配策略组参数 ' + key, 'group:' + name);
  return name + ' = ' + fields.join(', ');
}

/** 所有分流规则按列表顺序托管；[Rule] 仅保留最终兜底。 */
export function stringifyLoon(result: Pick<MihomoRenderResult, 'config' | 'rulesets' | 'report'>): string {
  const { config, report } = result;
  try {
    const base = stringifyIniBase({ ...(config.general ? { general: config.general } : {}), ...(config.host ? { host: config.host } : {}) });
    const names = new Set([...(config.proxies as Fields[]).map(n => String(n.name)), ...(config['proxy-groups'] as Fields[]).map(g => String(g.name))]);
    const chains: string[] = [];
    const proxies = (config.proxies as Fields[]).flatMap(node => {
      const copy = { ...node };
      if (copy['dialer-proxy'] !== undefined) {
        let internal = String(node.name) + '_链落地', i = 2;
        while (names.has(internal)) internal = String(node.name) + '_链落地_' + i++;
        names.add(internal);
        chains.push(iniName(node.name) + ' = ' + iniName(String(node['dialer-proxy'])) + ', ' + iniName(internal) + (node.udp === undefined ? '' : ', udp=' + iniValue(node.udp)));
        copy.name = internal; delete copy['dialer-proxy'];
      }
      const line = loonProxyLine(copy, report); return line ? [line] : [];
    });
    const groups = (config['proxy-groups'] as Fields[]).map(group => loonGroup(group, report));
    const remoteRules: string[] = [];
    const providers = (config['rule-providers'] ?? {}) as Record<string, Fields>;
    const rules = (config.rules as string[]).flatMap(line => {
      if (/[\r\n\u2028\u2029\0]/.test(line)) throw new Error('规则不能包含换行或空字符');
      if (line.startsWith('MATCH,')) return ['FINAL,' + iniName(line.slice(6))];
      const match = /^RULE-SET,([^,]+),(.+)$/.exec(line);
      if (!match) throw new Error('Loon 分流规则必须使用托管链接');
      const url = providers[match[1]!]?.url;
      if (typeof url !== 'string' || !url.trim()) throw new Error('Loon 缺少托管规则地址');
      remoteRules.push(iniValue(url) + ',policy=' + iniName(match[2]) + ',enabled=true');
      return [];
    });
    return [base.trim(), '[Proxy]', ...proxies, ...(chains.length ? ['', '[Proxy Chain]', ...chains] : []), '', '[Proxy Group]', ...groups, '', '[Rule]', ...rules, ...(remoteRules.length ? ['', '[Remote Rule]', ...remoteRules] : []), ''].filter((s, i) => i !== 0 || s).join('\n');
  } catch (cause) { report.error('loon.format', cause instanceof Error ? cause.message : 'Loon 配置格式不合法'); return ''; }
}
