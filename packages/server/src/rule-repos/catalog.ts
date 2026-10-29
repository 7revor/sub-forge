// 缓存物理文本文件及引用身份；完整路径原样保留，不存储目录节点。
import type { IndexedEntry, RepoDefinition } from './adapters.ts';
import { isIndexedRuleFile } from './generic.ts';

export type CatalogNode = { kind: 'file'; ref: string; path: string; entry?: string };

export function buildCatalog(repo: RepoDefinition, trees: Record<string, string[]>, entries: IndexedEntry[]): CatalogNode[] {
  const selectable = new Map<string, string>();
  for (const entry of entries) for (const variant of entry.variants) for (const file of variant.files) selectable.set(JSON.stringify([file.ref, file.path]), entry.path);
  const nodes = new Map<string, CatalogNode>();
  const scopes = new Set<string>();
  for (const scan of repo.scans) {
    const scope = JSON.stringify([scan.ref, scan.directory]);
    if (scopes.has(scope)) continue;
    scopes.add(scope);
    const prefix = scan.directory ? scan.directory + '/' : '';
    for (const path of trees[scan.ref] ?? []) {
      if (!path.startsWith(prefix)) continue;
      if (!isIndexedRuleFile(path)) continue;
      const key = JSON.stringify([scan.ref, path]);
      const entry = selectable.get(key);
      nodes.set(key, { kind: 'file', ref: scan.ref, path, ...(entry !== undefined ? { entry } : {}) });
    }
  }
  return [...nodes.values()].sort((a, b) => a.ref.localeCompare(b.ref) || a.path.localeCompare(b.path));
}
