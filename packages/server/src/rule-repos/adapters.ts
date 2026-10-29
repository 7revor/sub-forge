// 所有仓库使用同一个配置驱动的目录索引器；默认仓库仅提供初始化数据。
import type { RuleSetFormat } from '@sub-forge/core';
import { matchesGeneric, pathGlob, type ScanConfig } from './generic.ts';

export type RepoDefinition = {
  id: string; name: string; owner: string; repo: string; refs: string[]; license: string; scans: ScanConfig[];
};
const base = { include: ['**/*.list', '**/*.txt'], exclude: [], preferred: [], readme: false };
export const BUILTIN_REPOS: RepoDefinition[] = [
  { id: 'blackmatrix7', name: 'blackmatrix7/ios_rule_script', owner: 'blackmatrix7', repo: 'ios_rule_script', refs: ['master'], license: 'GPL-2.0',
    scans: (['mihomo', 'surge'] as const).flatMap(client => {
      const common = { ...base, ref: 'master', directory: client === 'mihomo' ? 'rule/Clash' : 'rule/Surge', client, groupBy: 'directory' as const, readme: true, preferred: ['*_All.list'] };
      return [
        { ...common, include: ['**/*_Domain.list', '**/*_Domain_*.list'], format: client === 'surge' ? 'domain-set' as const : 'domain' as const },
        { ...common, include: ['**/*_IP.list', '**/*_IP_*.list'], format: 'ipcidr' as const },
        { ...common, exclude: ['**/*_Domain.list', '**/*_Domain_*.list', '**/*_IP.list', '**/*_IP_*.list'], format: 'classical' as const },
      ];
    }) },
  { id: 'zydou', name: 'zydou/domain-list-community-converter', owner: 'zydou', repo: 'domain-list-community-converter', refs: ['surge-rule-set', 'surge-domain-set'], license: '见上游仓库许可证',
    scans: [
      { ...base, ref: 'surge-rule-set', directory: '', include: ['*.txt', '*.list'], exclude: ['*@-*'], client: 'surge', groupBy: 'stem', format: 'classical' },
      { ...base, ref: 'surge-domain-set', directory: '', include: ['*.txt', '*.list'], exclude: ['*@-*'], client: 'surge', groupBy: 'stem', format: 'domain-set' },
    ] },
];
export type RepoFile = { path: string; ref: string; commit?: string; format: RuleSetFormat; behavior?: 'classical' | 'domain' | 'ipcidr' };
export type RepoVariant = { id: string; client: 'mihomo' | 'surge' | 'any'; label: string; files: RepoFile[]; recommended?: boolean; readme?: boolean };
export type IndexedEntry = { repo: string; path: string; name: string; variants: RepoVariant[] };
export const normalizeSearch = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[-_\s]+/g, '');
export const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');
// 导入仍跟踪分支；预览固定到本次索引的提交，避免目录与正文来自不同版本。
export const rawUrl = (repo: RepoDefinition, file: RepoFile) => `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${encodeURIComponent(file.ref)}/${encodePath(file.path)}`;
export const upstreamUrl = (repo: RepoDefinition, file: RepoFile) => `https://github.com/${repo.owner}/${repo.repo}/blob/${encodeURIComponent(file.commit ?? file.ref)}/${encodePath(file.path)}`;

export function buildEntries(repo: RepoDefinition, trees: Record<string, string[]>, revisions: Record<string, string> = {}): IndexedEntry[] {
  const entries = new Map<string, IndexedEntry>();
  const seen = new Set<string>();
  const scores = new Map<string, number>();
  for (const scan of repo.scans) {
    for (const path of [...(trees[scan.ref] ?? [])].sort()) {
      if (!matchesGeneric(path, scan) || seen.has(`${scan.ref}:${path}`)) continue;
      seen.add(`${scan.ref}:${path}`);
      const relative = scan.directory ? path.slice(scan.directory.length + 1) : path;
      const stem = relative.replace(/\.[^.]+$/, '').trimEnd();
      const key = scan.groupBy === 'path' ? path : scan.groupBy === 'stem' ? stem : relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/')) : stem;
      let entry = entries.get(key);
      if (!entry) { entry = { repo: repo.id, path: key, name: scan.groupBy === 'path' ? path.replace(/\.[^.]+$/, '') : key, variants: [] }; entries.set(key, entry); }
      const group = scan.groupBy === 'stem' ? key : path;
      const id = `${scan.client}:${scan.ref}:${group}`;
      let variant = entry.variants.find(v => v.id === id);
      if (!variant) {
        variant = { id, client: scan.client, label: scan.groupBy === 'stem' ? scan.ref : path.split('/').at(-1)!, files: [], readme: scan.readme };
        entry.variants.push(variant);
      }
      const behavior = scan.format === 'classical' || scan.format === 'ipcidr' ? scan.format : scan.format === 'domain' || scan.format === 'domain-set' ? 'domain' : undefined;
      variant.files.push({ ref: scan.ref, path, format: scan.format, behavior, ...(revisions[scan.ref] ? { commit: revisions[scan.ref] } : {}) });
      const preferred = scan.preferred.findIndex(p => pathGlob(p).test(path.split('/').at(-1)!));
      const score = preferred >= 0 ? preferred : scan.preferred.length + (path.split('/').at(-1) === `${key.split('/').at(-1)}.list` ? 0 : 1);
      scores.set(id, score);
    }
  }
  for (const entry of entries.values()) for (const client of ['mihomo', 'surge', 'any'] as const) {
    const choices = entry.variants.filter(v => v.client === client).sort((a, b) => (scores.get(a.id) ?? 0) - (scores.get(b.id) ?? 0));
    if (choices[0]) choices[0].recommended = true;
  }
  return [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/** 只读取「使用说明 / 配置建议」段，避免把上游来源中的文件名误当成组合。 */
export function applyReadme(entry: IndexedEntry, client: RepoVariant['client'], readme: string, scope?: { ref: string; directory: string }): void {
  const matches = (v: RepoVariant) => v.client === client && (!scope || v.files.every(f => f.ref === scope.ref && f.path.slice(0, f.path.lastIndexOf('/') + 1) === scope.directory));
  const usage = /#### 使用说明\s*([\s\S]*?)(?=#### |## |$)/.exec(readme)?.[1] ?? '';
  for (const variant of entry.variants.filter(matches)) {
    const file = variant.files[0]!;
    const filename = file.path.split('/').at(-1)!;
    const line = usage.split('\n').find(l => l.startsWith(`- ${filename}，`));
    const behavior = line && /behavior:\s*["']?(classical|domain|ipcidr)/.exec(line)?.[1];
    if (behavior) file.behavior = behavior as RepoFile['behavior'];
    if (line?.includes('DOMAIN-SET')) file.format = 'domain-set';
  }
  const advice = /#### 配置建议\s*([\s\S]*?)(?=#### |## |$)/.exec(readme)?.[1] ?? '';
  let first: RepoVariant | undefined;
  for (const line of advice.split('\n')) {
    // 只用无条件建议；IPv4 或版本条件不能当成通用默认。
    const match = /^- ([^。]+?)\s+(单独使用|共同使用)。/.exec(line);
    if (!match) continue;
    const names = match[1]!.split('、');
    const parts = names.map(name => entry.variants.find(v => matches(v) && v.files.length === 1 && v.files[0]!.path.split('/').at(-1) === name));
    if (parts.some(p => !p)) continue;
    let variant = parts[0]!;
    if (parts.length > 1) {
      variant = { id: `${client}:组合:${scope ? `${scope.ref}:${scope.directory}:` : ''}${names.join('+')}`, client, label: names.join(' + '), files: parts.flatMap(p => p!.files) };
      if (!entry.variants.some(v => v.id === variant.id)) entry.variants.push(variant);
    }
    first ??= variant;
  }
  if (first) {
    for (const v of entry.variants.filter(matches)) v.recommended = v.id === first.id;
  }
}
