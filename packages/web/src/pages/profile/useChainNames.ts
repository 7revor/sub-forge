import { chainSources, type ChainRule } from '@sub-forge/core';
import { useQueries } from '@tanstack/react-query';
import { nodeListOptions } from '../../hooks.ts';
import { useModalPresentation } from '../../modals/index.tsx';
import { filterNodes } from '../../components/nodeMatch.ts';
import { useProfile } from './context.ts';
import { landingNodeName } from './chainModel.ts';

/** 摘要仅显示实际节点名或组名，来源信息保留在来源选择区域。 */
export function useChainNames(chain: ChainRule) {
  const { draft, groupName } = useProfile();
  const via = chain.via;
  const exactVia = via.kind === 'node' && 'exact' in via.ref.match ? via.ref.match.exact : undefined;
  const exactLanding = landingNodeName(chain.landing);
  const viaFilter = via.kind === 'node' && 'regex' in via.ref.match ? via.ref.match.regex : undefined;
  const viaSources = via.kind === 'node' && !exactVia ? chainSources(via.ref.nodeSet, draft.nodeSets) : [];
  const landingSources = exactLanding ? [] : chainSources(chain.landing.nodeSet, draft.nodeSets);
  const requests = [...viaSources.map(s => ({ ref: s.ref, filter: viaFilter, excludeFilter: undefined })), ...landingSources.map(s => ({ ref: s.ref, filter: chain.landing.filter, excludeFilter: chain.landing.excludeFilter }))];
  const queries = useQueries({ queries: requests.map(({ ref, filter, excludeFilter }) => ({ ...nodeListOptions(ref, '', { filter, excludeFilter }), enabled: !filterNodes([], { filter, excludeFilter }).error })) });
  const names = (from: number, to: number, first: boolean) => {
    const selected = queries.slice(from, to);
    if (requests.slice(from, to).some(r => filterNodes([], r).error)) return '筛选表达式无效';
    if (selected.some(q => q.error || q.data?.report.some(item => item.level === 'error'))) return '节点读取失败';
    if (selected.some(q => !q.data)) return '正在读取节点…';
    const nodes = selected.flatMap(q => q.data?.nodes ?? []).map(n => n.name);
    return first ? nodes[0] ?? '没有匹配节点' : nodes.length ? [...new Set(nodes)].join('、') + (selected.some(q => q.data?.truncated) ? '…' : '') : '没有匹配节点';
  };
  return useModalPresentation({
    via: via.kind === 'group' ? via.groupId ? groupName(via.groupId) : '待选前置' : via.kind === 'builtin' ? via.name : exactVia ?? names(0, viaSources.length, true),
    landing: exactLanding ?? names(viaSources.length, queries.length, false),
  });
}
