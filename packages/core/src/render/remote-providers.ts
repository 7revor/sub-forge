// 客户端远程节点入口只读取本服务产物；筛选在服务端随每次资源刷新重新执行。
import { stringify } from 'yaml';
import type { Client } from '../types.ts';
import type { Report } from '../report.ts';
import { shortHash, stableStringify } from '../util/hash.ts';
import type { ProviderOutput, UrlBuilder } from './mihomo.ts';
import { surgeProxyLine } from './surge-proxy.ts';
import { loonProxyLine } from './loon-proxy.ts';

type Fields = Record<string, unknown>;
type Group = Fields & { name: string; proxies?: string[]; use?: string[] };
type Filter = { filter?: string; excludeFilter?: string; excludeType?: string };

export function lowerRemoteProviders(input: {
  client: Exclude<Client, 'mihomo'>;
  groups: Group[];
  providers: Record<string, ProviderOutput>;
  proxyProviders: Record<string, Fields>;
  nodes: Map<string, Fields[]>;
  urls: UrlBuilder;
  report: Report;
  nodeReferences: Map<string, string>;
  filter: (nodes: Fields[], spec: Filter) => Fields[];
}): void {
  const { client, groups, providers, proxyProviders, nodes, urls, report } = input;
  const originals = new Map(Object.entries(providers).map(([key, p]) => [p.name, { key, nodes: nodes.get(p.name) ?? [] }]));
  const interval = Object.values(proxyProviders)[0]?.interval;
  const occupied = new Set([...groups.map(g => g.name), ...groups.flatMap(g => g.proxies ?? []), ...[...nodes.values()].flat().map(n => String(n.name)), ...originals.keys()]);
  const aliases = new Map<string, string>();
  for (const [name, source] of originals) {
    // Loon 的订阅名和策略名共用引用空间，必须避免重名后选错成员。
    let alias = name;
    if (client === 'loon' && (groups.some(g => g.name === name || g.proxies?.includes(name)) || [...nodes.values()].some(ns => ns.some(n => n.name === name)))) {
      alias = `__provider_${shortHash(source.key, 16)}`;
      while (occupied.has(alias)) alias += '_';
      occupied.add(alias);
    }
    aliases.set(name, alias);
  }
  const commonProvider = Object.values(proxyProviders)[0] ?? {};
  for (const name of Object.keys(proxyProviders)) delete proxyProviders[name];

  const publish = (key: string, name: string, selected: Fields[], sourceKeys: string[]) => {
    const body = client === 'stash' ? stringify({ proxies: selected }, { lineWidth: 0 }) : selected.flatMap(node => {
      const line = (client === 'surge' ? surgeProxyLine : loonProxyLine)(node, report);
      return line ? [line] : [];
    }).join('\n') + '\n';
    providers[key] = { name, yaml: body, sourceKeys, nodeCount: selected.length };
    // 空远程集合在部分客户端会变为 DIRECT：主配置改用 REJECT，资源接口拒绝下发空正文。
    if (selected.length) proxyProviders[name] = client === 'stash' ? { ...commonProvider, url: urls.provider(key), interval } : { url: urls.provider(key), interval };
    return name;
  };
  for (const [name, source] of originals) {
    if (client === 'loon' && source.nodes.some(n => n['dialer-proxy'])) {
      report.error('loon.provider-chain', 'Loon 远程节点订阅不能携带 [Proxy Chain]；请将代理链的落地来源设为展开，前置来源可以保留引用', source.key);
    }
    publish(source.key, aliases.get(name)!, source.nodes, [source.key]);
  }

  for (const group of groups) {
    const use = [...new Set(group.use ?? [])];
    const spec: Filter = {
      ...(typeof group.filter === 'string' ? { filter: group.filter } : {}),
      ...(typeof group['exclude-filter'] === 'string' ? { excludeFilter: group['exclude-filter'] } : {}),
      ...(typeof group['exclude-type'] === 'string' ? { excludeType: group['exclude-type'] } : {}),
    };
    const sources = use.flatMap(name => originals.has(name) ? [originals.get(name)!] : []);
    const exactName = input.nodeReferences.get(group.name);
    const filtered = sources.flatMap(source => exactName === undefined ? input.filter(source.nodes, spec) : source.nodes.filter(n => n.name === exactName));
    // 同一节点可能经多个来源成员被引入；顺序按成员声明保留。
    const selected = [...new Map(filtered.map(node => [String(node.name), node])).values()];
    let remote: string[] = [];
    if (selected.length) {
      if (Object.keys(spec).length || client === 'surge' && sources.length > 1) {
        const sourceKeys = sources.map(s => s.key);
        const key = 'view:' + shortHash(stableStringify({ sourceKeys, spec, exactName }), 16);
        let name = providers[key]?.name ?? '__provider_' + key.slice(5);
        if (!providers[key]) {
          while (occupied.has(name)) name += '_';
          occupied.add(name);
          publish(key, name, selected, sourceKeys);
        }
        remote = [name];
      } else remote = use.filter(name => originals.get(name)?.nodes.length).map(name => aliases.get(name)!);
    }
    delete group.use;
    for (const key of ['filter', 'exclude-filter', 'exclude-type', 'empty-fallback']) delete group[key];
    if (remote.length) {
      if (client === 'surge') {
        group['policy-path'] = proxyProviders[remote[0]!]!.url;
        group['update-interval'] = interval;
      } else group.use = remote;
    } else if (use.length && !group.proxies?.length) {
      group.proxies = ['REJECT'];
      report.warn('group.empty', `组「${group.name}」没有成员，按拒绝输出；新增远程节点后需刷新主订阅恢复引用`, 'group:' + group.name);
    }
    if (client === 'loon' && input.nodeReferences.has(group.name)) delete group.hidden;
  }
}
