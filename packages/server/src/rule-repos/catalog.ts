// 保存平面的目录和文本文件清单，嵌套结构由前端按扫描根目录组装。
import type { IndexedEntry, RepoDefinition } from './adapters.ts';
import { isIndexedRuleFile } from './generic.ts';

export type CatalogNode = { kind: 'file' | 'directory'; ref: string; root: string; path: string; entry?: string };

export function buildCatalog(repo: RepoDefinition, trees: Record<string, string[]>, entries: IndexedEntry[]): CatalogNode[] {
  const selectable = new Map<string, string>();
  for (const entry of entries) for (const variant of entry.variants) for (const file of variant.files) selectable.set(JSON.stringify([file.ref, file.path]), entry.path);
  const nodes = new Map<string, CatalogNode>();
  const scopes = new Set<string>();
  for (const scan of repo.scans) {
    const scope = JSON.stringify([scan.ref, scan.directory]);
    if (scopes.has(scope)) continue;
    scopes.add(scope);
    const add = (kind: CatalogNode['kind'], path: string, entry?: string) => {
      const key = JSON.stringify([scan.ref, kind, path]);
      if (!nodes.has(key)) nodes.set(key, { kind, ref: scan.ref, root: scan.directory, path, ...(entry !== undefined ? { entry } : {}) });
    };
    add('directory', scan.directory);
    const prefix = scan.directory ? scan.directory + '/' : '';
    for (const path of trees[scan.ref] ?? []) {
      if (!path.startsWith(prefix)) continue;
      if (isIndexedRuleFile(path)) add('file', path, selectable.get(JSON.stringify([scan.ref, path])));
      const parts = path.slice(prefix.length).split('/');
      parts.pop();
      for (let depth = 1; depth <= parts.length; depth++) add('directory', prefix + parts.slice(0, depth).join('/'));
    }
  }
  return [...nodes.values()].sort((a, b) => a.ref.localeCompare(b.ref) || a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind));
}
