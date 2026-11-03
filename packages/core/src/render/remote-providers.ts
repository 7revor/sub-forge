// 客户端远程节点入口只读取本服务产物；组级筛选使用客户端原生能力，原生无法表达的排除条件才由本服务生成派生资源。
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

export type RemoteFilter = { sources: string[]; filter: string };

export function lowerRemoteProviders(input: {
  client: Exclude<Client, 'mihomo'>;
  groups: Group[];
  providers: Record<string, ProviderOutput>;
  proxyProviders: Record<string, Fields>;
  remoteFilters: Record<string, RemoteFilter>;
  nodes: Map<string, Fields[]>;
  urls: UrlBuilder;
  report: Report;
  nodeReferences: Set<string>;
  filter: (nodes: Fields[], spec: Filter) => Fields[];
}): void {
  const { client, groups, providers, proxyProviders, remoteFilters, nodes, urls, report } = input;
  const originals = new Map(Object.entries(providers).map(([key, p]) => [p.name, { key, nodes: nodes.get(p.name) ?? [] }]));
  const interval = Object.values(proxyProviders)[0]?.interval;
  const occupied = new Set([...groups.map(g => g.name), ...groups.flatMap(g => g.proxies ?? []), ...[...nodes.values()].flat().map(n => String(n.name)), ...originals.keys()]);
  const freeName = (name: string) => {
    while (occupied.has(name)) name += '_';
    occupied.add(name);
    return name;
  };
  const aliases = new Map<string, string>();
  for (const [name, source] of originals) {
    // Surge 内联组和 Loon 订阅名与策略名共用引用空间，必须避免重名后选错成员。
    const conflict = client !== 'stash' && (groups.some(g => g.name === name || g.proxies?.includes(name)) || [...nodes.values()].some(ns => ns.some(n => n.name === name)));
    aliases.set(name, conflict ? freeName(`__provider_${shortHash(source.key, 16)}`) : name);
  }
  const commonProvider = Object.values(proxyProviders)[0] ?? {};
  for (const name of Object.keys(proxyProviders)) delete proxyProviders[name];

  const publish = (key: string, name: string, selected: Fields[], sourceKeys: string[]) => {
    const body = client === 'stash' ? stringify({ proxies: selected }, { lineWidth: 0 }) : selected.flatMap(node => {
      const line = (client === 'surge' ? surgeProxyLine : loonProxyLine)(node, report);
      return line ? [line] : [];
    }).join('\n') + '\n';
    providers[key] = { name, yaml: body, sourceKeys };
  };
  const declared = new Map<string, string>();
  for (const [name, source] of originals) {
    if (client === 'loon' && source.nodes.some(n => n['dialer-proxy'])) {
      report.error('loon.provider-chain', 'Loon 远程节点订阅不能携带 [Proxy Chain]；请将代理链的落地来源设为展开，前置来源可以保留引用', source.key);
    }
    publish(source.key, aliases.get(name)!, source.nodes, [source.key]);
  }

  const views = new Map<string, string>();
  const filters = new Map<string, string>();
  const referenced = new Set<string>();
  for (const group of groups) {
    const use = [...new Set(group.use ?? [])].filter(name => originals.has(name));
    const filter = typeof group.filter === 'string' ? group.filter : undefined;
    const excludeFilter = typeof group['exclude-filter'] === 'string' ? group['exclude-filter'] : undefined;
    const excludeType = typeof group['exclude-type'] === 'string' ? group['exclude-type'] : undefined;
    delete group.use;
    delete group['exclude-filter'];
    delete group['exclude-type'];
    if (client !== 'stash') delete group['empty-fallback'];
    if (!use.length) { delete group.filter; continue; }
    let members: string[], nativeFilter = filter;
    if (excludeFilter !== undefined || excludeType !== undefined) {
      // 三端都只有名称筛选：排除条件由本服务筛好，随资源刷新重新执行。
      const sources = use.map(name => originals.get(name)!);
      const spec: Filter = { ...(filter !== undefined ? { filter } : {}), ...(excludeFilter !== undefined ? { excludeFilter } : {}), ...(excludeType !== undefined ? { excludeType } : {}) };
      const sourceKeys = sources.map(s => s.key);
      const key = 'view:' + shortHash(stableStringify({ sourceKeys, spec }), 16);
      let name = views.get(key);
      if (name === undefined) {
        name = freeName('__provider_' + key.slice(5));
        views.set(key, name);
        // 同一节点可能经多个来源成员被引入；顺序按成员声明保留。
        const selected = [...new Map(sources.flatMap(source => input.filter(source.nodes, spec)).map(node => [String(node.name), node])).values()];
        publish(key, name, selected, sourceKeys);
      }
      members = [name];
      nativeFilter = undefined;
    } else {
      for (const name of use) referenced.add(name);
      members = use.map(name => aliases.get(name)!);
    }
    delete group.filter;
    if (client === 'surge') {
      group['include-other-group'] = members;
      if (nativeFilter !== undefined) group['policy-regex-filter'] = nativeFilter;
    } else if (client === 'loon' && nativeFilter !== undefined) {
      const key = stableStringify({ members, nativeFilter });
      let name = filters.get(key);
      if (name === undefined) {
        name = freeName(group.name + '_筛选');
        filters.set(key, name);
        remoteFilters[name] = { sources: members, filter: nativeFilter };
      }
      group.use = [name];
    } else {
      group.use = members;
      if (nativeFilter !== undefined) group.filter = nativeFilter;
    }
    if (client === 'loon' && input.nodeReferences.has(group.name)) delete group.hidden;
  }

  for (const [name, source] of originals) if (referenced.has(name)) declared.set(aliases.get(name)!, source.key);
  for (const [key, name] of views) declared.set(name, key);
  for (const [name, key] of declared) {
    const url = urls.provider(key);
    if (client === 'surge') groups.push({ name, type: 'select', 'policy-path': url, 'update-interval': interval, hidden: true });
    else proxyProviders[name] = client === 'stash' ? { ...commonProvider, url, interval } : { url, interval };
  }
}
