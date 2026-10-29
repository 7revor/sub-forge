import type { RuleCatalog } from '../api.ts';
import type { CascaderOption } from '../components/listbox.tsx';

export type RuleCatalogSelection = { source: 'local'; id: string } | { source: 'repository'; repo: string; entry: string; file: { ref: string; path: string } };

/** 扫描根不成为分类；真实子目录递归嵌套，同名叶子按分支和完整路径区分。 */
export function buildRuleCatalog(catalog: RuleCatalog): CascaderOption[] {
  const options: CascaderOption[] = catalog.locals.map(local => ({ value: JSON.stringify({ source: 'local', id: local.id }), label: `本地 · ${local.name}`, hint: local.hint }));
  for (const repo of catalog.repositories) {
    const children: CascaderOption[] = [];
    const directories = new Map<string, CascaderOption[]>();
    directories.set('', children);
    const folder = (path: string): CascaderOption[] => {
      const found = directories.get(path);
      if (found) return found;
      const parts = path.split('/');
      const label = parts.pop()!;
      const nested: CascaderOption[] = [];
      folder(parts.join('/')).push({ value: JSON.stringify(['directory', repo.id, path]), label, children: nested });
      directories.set(path, nested);
      return nested;
    };
    const seen = new Set<string>();
    for (const node of repo.nodes) {
      const prefix = node.root ? node.root + '/' : '';
      if (node.path === node.root && node.kind === 'directory') continue;
      if (!node.path.startsWith(prefix)) continue;
      const relative = node.path.slice(prefix.length);
      if (node.kind === 'directory') { folder(relative); continue; }
      const key = JSON.stringify([node.ref, node.path]);
      if (seen.has(key)) continue;
      seen.add(key);
      const parts = relative.split('/');
      const label = parts.pop()!;
      const selection: RuleCatalogSelection = { source: 'repository', repo: repo.id, entry: node.entry ?? '', file: { ref: node.ref, path: node.path } };
      folder(parts.join('/')).push({ value: JSON.stringify(selection), label, hint: `${repo.name} · ${node.path} · 分支：${node.ref}${node.entry === undefined ? ' · 不可关联' : ''}`, disabled: node.entry === undefined });
    }
    const sort = (items: CascaderOption[]) => {
      items.sort((a, b) => Number(!!b.children) - Number(!!a.children) || a.label.localeCompare(b.label, 'zh-CN') || a.value.localeCompare(b.value));
      for (const item of items) if (item.children) sort(item.children);
    };
    sort(children);
    options.push({ value: JSON.stringify(['repository', repo.id]), label: repo.name, children });
  }
  return options;
}
