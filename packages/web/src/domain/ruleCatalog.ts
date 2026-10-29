import { api, type RuleCatalog } from '../api.ts';
import type { TreeLoader, TreePage } from '../components/listbox.tsx';

export type RuleCatalogSelection = { source: 'local'; id: string } | { source: 'repository'; repo: string; entry: string; file: { ref: string; path: string } };
type CatalogBranch = { kind: 'repository'; repo: string } | { kind: 'directory'; repo: string; path: string };

/** 每页只映射当前层；目录完整路径原样传给下一层请求，不按名称重组；文件保留路径和分支。 */
export function buildRuleCatalog(catalog: RuleCatalog): TreePage {
  return { total: catalog.total, nextOffset: catalog.nextOffset, notices: catalog.notices, options: catalog.items.map(item => {
    if (item.kind === 'local') return { value: JSON.stringify({ source: 'local', id: item.id }), label: `本地 · ${item.name}`, hint: item.hint };
    if (item.kind === 'repository') return { value: JSON.stringify({ kind: item.kind, repo: item.repo }), label: item.name, branch: true };
    if (item.kind === 'directory') return { value: JSON.stringify({ kind: item.kind, repo: item.repo, path: item.path }), label: item.name, branch: true };
    const selection: RuleCatalogSelection = { source: 'repository', repo: item.repo, entry: item.entry ?? '', file: { ref: item.ref, path: item.path } };
    return { value: JSON.stringify(selection), label: item.name, hint: `${item.path} · 分支：${item.ref}${item.entry === undefined ? ' · 不可关联' : ''}`, disabled: item.entry === undefined };
  }) };
}

export const ruleCatalogLoader = (scope: 'all' | 'repository'): TreeLoader => async (query, offset, parent) => {
  const params = new URLSearchParams({ scope, q: query, offset: String(offset), limit: '30' });
  if (parent) {
    const branch = JSON.parse(parent) as CatalogBranch;
    params.set('repo', branch.repo);
    if (branch.kind === 'directory') params.set('directory', branch.path);
  }
  return buildRuleCatalog(await api<RuleCatalog>('GET', `/rule-options/catalog?${params}`));
};
