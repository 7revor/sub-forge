// 在公共依赖解析之后输出 Surge；基础设置不从 Mihomo DNS/TUN 字段猜测转换。
import type { GroupSpec } from '../types.ts';
import type { Report } from '../report.ts';
import type { MihomoRenderResult } from './mihomo.ts';
import { composeRule } from '../rules/client.ts';
import { rawRuleParts } from '../rules/raw.ts';
import { iniName, iniValue, stringifyIniBase } from './ini-format.ts';
import { surgeProxyLine } from './surge-proxy.ts';

type Fields = Record<string, unknown>;

export function surgeBenchmarks(groups: Fields[], nodes: Fields[], specs: GroupSpec[], report: Report): void {
  const groupMap = new Map(groups.map(g => [String(g.name), g]));
  const nodeMap = new Map(nodes.map(n => [String(n.name), n]));
  const visit = (name: string, patch: Fields, seen: Set<string>, where: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    const node = nodeMap.get(name);
    if (node) {
      for (const [key, value] of Object.entries(patch)) {
        if (node[key] !== undefined && node[key] !== value) report.error('surge.benchmark-conflict', '共享节点「' + name + '」设置了不同的 ' + key + '，请统一测速参数', where);
        else node[key] = value;
      }
    } else for (const member of groupMap.get(name)?.proxies as string[] ?? []) visit(member, patch, seen, where);
  };
  for (const group of specs) {
    if (group.type === 'select') continue;
    const patch: Fields = {};
    if (group.test?.url !== undefined) patch['test-url'] = group.test.url;
    if (group.test?.timeout !== undefined) patch['test-timeout'] = group.test.timeout / 1000;
    if (Object.keys(patch).length) visit(group.name, patch, new Set(), 'group:' + group.id);
  }
}

function surgeGroup(group: Fields, report: Report): string {
  const name = iniName(group.name), fields = [String(group.type), ...[...new Set(group.proxies as string[] ?? [])].map(iniName)];
  const known = new Set(['name','type','proxies','url','timeout','interval','tolerance','hidden','icon','strategy','lazy','max-failed-times','expected-status','empty-fallback']);
  const add = (key: string, value: unknown) => { if (value !== undefined) fields.push(key + '=' + iniValue(value)); };
  add('interval', group.interval); add('tolerance', group.tolerance); add('hidden', group.hidden); add('icon-url', group.icon);
  for (const key of ['no-alert', 'evaluate-before-use', 'category', 'persistent']) { known.add(key); add(key, group[key]); }
  if (group.strategy === 'consistent-hashing') add('persistent', true);
  else if (group.strategy !== undefined) report.error('surge.group-strategy', '组「' + name + '」的 ' + String(group.strategy) + ' 无法等价映射为 Surge 负载均衡', 'group:' + name);
  for (const key of ['lazy','max-failed-times','expected-status']) if (group[key] !== undefined) report.warn('surge.group-option', 'Surge 不支持组参数 ' + key + '，已省略', 'group:' + name);
  for (const key of Object.keys(group)) if (!known.has(key)) report.error('surge.group-option', 'Surge 尚未适配组参数 ' + key, 'group:' + name);
  return name + ' = ' + fields.join(', ');
}

export function stringifySurge(result: Pick<MihomoRenderResult, 'config' | 'rulesets' | 'report'>, standalone = false): string {
  const { config, report } = result;
  try {
    const base = stringifyIniBase({ ...(config.general ? { general: config.general } : {}), ...(config.host ? { host: config.host } : {}) });
    const proxies = (config.proxies as Fields[]).flatMap(node => {
      const line = surgeProxyLine(node, report);
      return line ? [line] : [];
    });
    const groups = (config['proxy-groups'] as Fields[]).map(group => surgeGroup(group, report));
    const providers = config['rule-providers'] as Record<string, Fields> ?? {};
    const rules = (config.rules as string[]).flatMap(line => {
      if (/[\r\n\u2028\u2029\0]/.test(line)) throw new Error('规则不能包含换行或空字符');
      if (line.startsWith('MATCH,')) return ['FINAL,' + line.slice(6)];
      const match = /^RULE-SET,([^,]+),(.+)$/.exec(line);
      if (!match) return [line];
      const key = match[1]!, target = iniName(match[2]!), provider = providers[key];
      if (!provider || typeof provider.url !== 'string') throw new Error('规则来源缺失');
      if (standalone) {
        const resource = Object.values(result.rulesets).find(resource => resource.providerName === key) ?? result.rulesets[key + '.list'];
        if (resource) return resource.text.split(/\r?\n/).filter(s => s.trim() && !s.trim().startsWith('#')).map(s => composeRule(rawRuleParts(s), target));
      }
      return ['RULE-SET,' + iniValue(provider.url) + ',' + target];
    });
    return ['#!FORBIDDEN-AUTO-UPGRADE smart-group', base.trim(), '[Proxy]', ...proxies, '', '[Proxy Group]', ...groups, '', '[Rule]', ...rules, ''].filter((s, i) => i !== 0 || s).join('\n');
  } catch (cause) {
    report.error('surge.format', cause instanceof Error ? cause.message : 'Surge 配置格式不合法');
    return '';
  }
}
