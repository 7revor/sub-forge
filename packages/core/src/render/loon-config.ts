import type { GroupSpec } from '../types.ts';
import type { Report } from '../report.ts';
import type { MihomoRenderResult } from './mihomo.ts';
import { composeRule } from '../rules/client.ts';
import { rawRuleParts } from '../rules/raw.ts';
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
  if (type !== 'select') {
    add('url', group.url); add('interval', group.interval);
    if (type === 'url-test') add('tolerance', group.tolerance);
    else add('max-timeout', group.timeout);
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

/** 所有规则集原位置展开，避免 [Remote Rule] 与本地规则具有不同优先级。 */
export function stringifyLoon(result: Pick<MihomoRenderResult, 'config' | 'rulesets' | 'report'>): string {
  const { config, report } = result;
  try {
    const base = stringifyIniBase({ ...(config.general ? { general: config.general } : {}), ...(config.host ? { host: config.host } : {}) });
    const proxies = (config.proxies as Fields[]).flatMap(node => { const line = loonProxyLine(node, report); return line ? [line] : []; });
    const groups = (config['proxy-groups'] as Fields[]).map(group => loonGroup(group, report));
    const rules = (config.rules as string[]).flatMap(line => {
      if (/[\r\n\u2028\u2029\0]/.test(line)) throw new Error('规则不能包含换行或空字符');
      if (line.startsWith('MATCH,')) return ['FINAL,' + iniName(line.slice(6))];
      const match = /^RULE-SET,([^,]+),(.+)$/.exec(line);
      if (!match) return [line];
      const file = Object.values(result.rulesets).find(file => file.providerName === match[1]);
      if (!file) throw new Error('Loon 缺少可内嵌的规则文本');
      const target = iniName(match[2]);
      return file.text.split(/\r?\n/).filter(rule => rule.trim() && !rule.trimStart().startsWith('#')).map(rule => composeRule(rawRuleParts(rule), target));
    });
    return [base.trim(), '[Proxy]', ...proxies, '', '[Proxy Group]', ...groups, '', '[Rule]', ...rules, ''].filter((s, i) => i !== 0 || s).join('\n');
  } catch (cause) { report.error('loon.format', cause instanceof Error ? cause.message : 'Loon 配置格式不合法'); return ''; }
}
