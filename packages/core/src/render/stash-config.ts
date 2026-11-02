// Stash 官方依据：docs/17-official-client-configuration-guides.md。
// 基于公共 Clash 产物应用少量已确认的字段差异；不另建解析器或代理链实现。
import { stringify } from 'yaml';
import { composeRule } from '../rules/client.ts';
import { rawRuleParts } from '../rules/raw.ts';
import type { MihomoRenderResult } from './mihomo.ts';
import type { Report } from '../report.ts';
import type { GroupSpec } from '../types.ts';
import { bandwidthMbps } from './node-semantics.ts';

/** 仅处理官方字段别名与单位，不维护节点、传输、扩展字段白名单。 */
function adaptProxy(node: Record<string, unknown>, report: Report): void {
  if (node.type === 'hysteria2' && node.password !== undefined) {
    node.auth = node.password;
    delete node.password;
  }
  if (node.type === 'hysteria' || node.type === 'hysteria2') {
    for (const direction of ['up', 'down']) {
      if (node[direction] === undefined) continue;
      const speed = bandwidthMbps(node[direction]);
      if (speed === undefined) {
        report.error('stash.bandwidth', `Stash 无法转换 ${direction} 带宽，请填写 Mbps 数值`, `proxy:${String(node.name)}`);
        continue;
      }
      node[`${direction}-speed`] = speed;
      delete node[direction];
    }
  }
}

/** 公共 Clash 产物的最小差异：节点别名、测速单位、空组策略。代理链完全沿用公共生成和校验。 */
export function applyStashCompatibility(groups: Record<string, unknown>[], nodes: Record<string, unknown>[], specs: GroupSpec[], report: Report, providers: Map<string, Record<string, unknown>[]>, remoteMembers: Map<string, string[]>): void {
  for (const node of [...nodes, ...[...providers.values()].flat()]) adaptProxy(node, report);
  stashBenchmarks(groups, nodes, specs, report, providers, remoteMembers);
  for (const group of groups) {
    delete group.url;
    delete group.timeout;
    delete group['empty-fallback'];
  }
}

/** Stash 的测试参数属于节点；共享节点要求测试参数一致，不能照搬组级 url/timeout。 */
function stashBenchmarks(groups: Record<string, unknown>[], nodes: Record<string, unknown>[], specs: GroupSpec[], report: Report, providers = new Map<string, Record<string, unknown>[]>(), remoteMembers = new Map<string, string[]>()): void {
  const groupMap = new Map(groups.map(g => [g.name as string, g]));
  const nodeMap = new Map([...nodes, ...[...providers.values()].flat()].map(n => [n.name as string, n]));
  const visit = (name: string, patch: Record<string, unknown>, seen: Set<string>, where: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    const node = nodeMap.get(name);
    if (node) {
      for (const [key, value] of Object.entries(patch)) {
        if (node[key] !== undefined && node[key] !== value) report.error('stash.benchmark-conflict', `节点「${name}」在多个位置设置了不同的 ${key}，请统一 Stash 延迟测试参数`, where);
        else node[key] = value;
      }
    } else {
      const group = groupMap.get(name);
      for (const member of group?.proxies as string[] ?? []) visit(member, patch, seen, where);
      for (const member of remoteMembers.get(name) ?? []) visit(member, patch, seen, where);
    }
  };
  for (const group of specs) {
    const patch: Record<string, unknown> = {};
    const output = groupMap.get(group.name);
    const url = output?.url ?? group.test?.url;
    const timeout = output?.timeout ?? group.test?.timeout;
    if (url !== undefined) patch['benchmark-url'] = url;
    if (timeout !== undefined) {
      if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout < 0) report.error('stash.benchmark-timeout', '测速超时必须为非负毫秒数', `group:${group.id}`);
      else patch['benchmark-timeout'] = timeout / 1000;
    }
    if (Object.keys(patch).length) visit(group.name, patch, new Set(), `group:${group.id}`);
  }
}

/** 导出可独立导入的快照文件；文本托管规则内嵌；二进制规则不能导出为独立文本文件。 */
export function exportStashConfig(result: Pick<MihomoRenderResult, 'config' | 'rulesets'>): string {
  const config = structuredClone(result.config);
  const providers = config['rule-providers'] as Record<string, unknown> | undefined;
  config.rules = (config.rules as string[]).flatMap(line => {
    const match = /^RULE-SET,([^,]+),(.+)$/.exec(line);
    if (!match) return [line];
    const file = Object.values(result.rulesets).find(file => file.providerName === match[1]);
    if (!file) return [line];
    if (file.text.startsWith('#subforge-binary-mrs\n')) throw new Error('二进制规则不能内嵌到独立文本配置，请使用托管订阅');
    if (providers) delete providers[match[1]!];
    return file.text.split(/\r?\n/).filter(rule => rule.trim() && !rule.trimStart().startsWith('#')).map(rule => composeRule(rawRuleParts(rule), match[2]));
  });
  if (providers && !Object.keys(providers).length) delete config['rule-providers'];
  return stringify(config, { lineWidth: 0 });
}
