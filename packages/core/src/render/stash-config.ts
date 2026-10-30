// Stash 官方依据：docs/17-official-client-configuration-guides.md。
// 共用节点、依赖和代理链解析，但不把 Mihomo 专用字段当作 Stash 配置输出。
import { stringify } from 'yaml';
import { composeRule } from '../rules/client.ts';
import { rawRuleParts } from '../rules/raw.ts';
import type { MihomoRenderResult } from './mihomo.ts';
import type { Report } from '../report.ts';
import type { GroupSpec, ProxyIR } from '../types.ts';

const TYPES = new Set(['ss', 'ssr', 'socks5', 'http', 'vmess', 'vless', 'trojan', 'snell', 'hysteria', 'hysteria2', 'tuic', 'wireguard', 'ssh', 'anytls', 'trusttunnel', 'juicity', 'mieru', 'masque', 'tailscale', 'direct']);

export function stashProxy(node: ProxyIR, report: Report): ProxyIR {
  const out = { ...node };
  const where = `proxy:${node.name}`;
  if (!TYPES.has(node.type)) report.error('stash.proxy-type', `Stash 尚未适配代理类型 ${node.type}`, where);
  if (node.network && !['tcp', 'ws', 'h2', 'http', 'grpc', ...(node.type === 'vless' ? ['xhttp'] : [])].includes(String(node.network))) {
    report.error('stash.transport', `Stash 尚未适配传输方式 ${String(node.network)}`, where);
  }
  if (node.type === 'hysteria2') {
    if (out.password !== undefined) {
      if (out.auth !== undefined && out.auth !== out.password) report.error('stash.auth-conflict', 'Hysteria2 的 auth 与 password 不一致', where);
      else out.auth = out.password;
      delete out.password;
    }
  }
  if (node.type === 'hysteria' || node.type === 'hysteria2') {
    for (const direction of ['up', 'down'] as const) {
      if (out[direction] === undefined) continue;
      const match = /^(\d+(?:\.\d+)?)\s*(?:(k|m|g)bps)?$/i.exec(String(out[direction]).trim());
      if (!match) { report.error('stash.bandwidth', `Stash 无法转换 ${direction} 带宽，请填写 Mbps 数值`, where); continue; }
      const speed = Number(match[1]) * (match[2]?.toLowerCase() === 'g' ? 1000 : match[2]?.toLowerCase() === 'k' ? 0.001 : 1);
      const key = `${direction}-speed`;
      if (out[key] !== undefined && out[key] !== speed) report.error('stash.bandwidth-conflict', `${direction} 与 ${key} 带宽不一致`, where);
      else out[key] = speed;
      delete out[direction];
    }
  }
  // smux 等功能不能在未适配时静默关闭，避免输出表面成功但行为变化的配置。
  for (const key of ['smux', 'reality-opts-extra', 'routing-mark', 'ip-version', 'dialer-proxy-group']) {
    if (out[key] !== undefined) report.error('stash.proxy-option', `Stash 尚未适配节点参数 ${key}`, where);
  }
  return out;
}

export function stashGroup(out: Record<string, unknown>, group: GroupSpec, report: Report): Record<string, unknown> {
  const result = { ...out, proxies: [...new Set(out.proxies as string[] | undefined)] };
  for (const key of ['url', 'timeout', 'max-failed-times', 'expected-status']) delete (result as Record<string, unknown>)[key];
  if (group.test?.maxFailedTimes !== undefined || group.test?.expectedStatus !== undefined) {
    report.error('stash.group-test', `Stash 尚未适配组「${group.name}」的最大失败次数或预期状态码`, `group:${group.id}`);
  }
  if (group.strategy === 'sticky-sessions') report.error('stash.group-strategy', 'Stash 不支持 sticky-sessions 负载均衡', `group:${group.id}`);
  // 高级原文只允许已确认的 Stash 组参数；不能覆盖解析后的成员或生成动态空组。
  const allowed = new Set(['interval', 'lazy', 'tolerance', 'hidden', 'icon', 'ssid-policy']);
  for (const [key, value] of Object.entries(group.extra ?? {})) {
    if (allowed.has(key)) (result as Record<string, unknown>)[key] = value;
    else report.error('stash.group-option', `Stash 尚未适配策略组参数 ${key}，请移除或使用已支持的配置`, `group:${group.id}`);
  }
  return result;
}

/** Stash 的测试参数属于节点；共享节点要求测试参数一致，不能照搬组级 url/timeout。 */
export function stashBenchmarks(groups: Record<string, unknown>[], nodes: Record<string, unknown>[], specs: GroupSpec[], report: Report): void {
  const groupMap = new Map(groups.map(g => [g.name as string, g]));
  const nodeMap = new Map(nodes.map(n => [n.name as string, n]));
  const visit = (name: string, patch: Record<string, unknown>, seen: Set<string>, where: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    const node = nodeMap.get(name);
    if (node) {
      for (const [key, value] of Object.entries(patch)) {
        if (node[key] !== undefined && node[key] !== value) report.error('stash.benchmark-conflict', `节点「${name}」在多个位置设置了不同的 ${key}，请统一 Stash 延迟测试参数`, where);
        else node[key] = value;
      }
    } else for (const member of groupMap.get(name)?.proxies as string[] ?? []) visit(member, patch, seen, where);
  };
  for (const group of specs) {
    const patch: Record<string, unknown> = {};
    if (group.test?.url) patch['benchmark-url'] = group.test.url;
    if (group.test?.timeout !== undefined) patch['benchmark-timeout'] = group.test.timeout / 1000;
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
