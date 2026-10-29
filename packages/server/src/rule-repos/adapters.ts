// GitHub 文件树转为逻辑规则；只索引已知的规则格式，不把 README 和脚本当成规则。
import type { RuleSetFormat } from '@sub-forge/core';
import { matchesGeneric, type GenericOptions } from './generic.ts';

export type RepoDefinition = {
  id: string; name: string; owner: string; repo: string; refs: string[]; license: string;
  adapter: 'blackmatrix7' | 'zydou' | 'generic';
  options?: GenericOptions;
};
export const BUILTIN_REPOS: RepoDefinition[] = [
  { id: 'blackmatrix7', name: 'blackmatrix7/ios_rule_script', owner: 'blackmatrix7', repo: 'ios_rule_script', refs: ['master'], license: 'GPL-2.0', adapter: 'blackmatrix7' },
  { id: 'zydou', name: 'zydou/domain-list-community-converter', owner: 'zydou', repo: 'domain-list-community-converter', refs: ['clash', 'mrs', 'surge-rule-set', 'surge-domain-set'], license: '见上游仓库许可证', adapter: 'zydou' },
];
export type RepoFile = { path: string; ref: string; format: RuleSetFormat; behavior?: 'classical' | 'domain' | 'ipcidr' };
export type RepoVariant = { id: string; client: 'mihomo' | 'surge' | 'any'; label: string; files: RepoFile[]; recommended?: boolean };
export type IndexedEntry = { repo: string; path: string; name: string; variants: RepoVariant[] };
export const normalizeSearch = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[-_\s]+/g, '');
export const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');
export const rawUrl = (repo: RepoDefinition, file: RepoFile) => `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${encodeURIComponent(file.ref)}/${encodePath(file.path)}`;
export const upstreamUrl = (repo: RepoDefinition, file: RepoFile) => `https://github.com/${repo.owner}/${repo.repo}/blob/${encodeURIComponent(file.ref)}/${encodePath(file.path)}`;

export function buildEntries(repo: RepoDefinition, trees: Record<string, string[]>): IndexedEntry[] {
  const entries = new Map<string, IndexedEntry>();
  const add = (key: string, client: RepoVariant['client'], label: string, file: RepoFile, group = file.path) => {
    let entry = entries.get(key);
    if (!entry) { entry = { repo: repo.id, path: key, name: key, variants: [] }; entries.set(key, entry); }
    const id = `${client}:${file.ref}:${group}`;
    let variant = entry.variants.find(v => v.id === id);
    if (!variant) { variant = { id, client, label, files: [] }; entry.variants.push(variant); }
    variant.files.push(file);
  };
  for (const [ref, paths] of Object.entries(trees)) {
    for (const path of paths.sort()) {
      if (repo.adapter === 'generic') {
        if (!repo.options || !matchesGeneric(path, repo.options)) continue;
        add(path, 'any', '通用文本', { ref, path, format: repo.options.format });
        entries.get(path)!.name = path.replace(/\.[^.]+$/, '');
      } else if (repo.adapter === 'zydou') {
        const ext = ref === 'clash' ? '.yml' : ref === 'mrs' ? '.mrs' : '.txt';
        if (path.includes('/') || !path.endsWith(ext)) continue;
        const key = path.slice(0, -ext.length).trimEnd();
        if (!key || /@-/.test(key)) continue;
        const client = ref.startsWith('surge-') ? 'surge' : 'mihomo';
        const format = ref === 'clash' ? 'yaml' : ref === 'mrs' ? 'mrs' : ref === 'surge-domain-set' ? 'domain-set' : 'classical';
        add(key, client, ref, { ref, path, format, behavior: ref === 'surge-rule-set' ? 'classical' : 'domain' }, key);
      } else {
        const match = /^rule\/(Clash|Surge)\/(.+)\/([^/]+\.(yaml|list|txt))$/.exec(path);
        if (!match) continue;
        const [, clientDir, key, filename, ext] = match;
        const behavior = /_Domain(?:_|\.)/.test(filename!) ? 'domain' : /_IP(?:_|\.)/.test(filename!) ? 'ipcidr' : 'classical';
        const format = ext === 'yaml' ? 'yaml' : behavior === 'domain' ? (clientDir === 'Surge' ? 'domain-set' : 'domain') : behavior;
        add(key!, clientDir === 'Clash' ? 'mihomo' : 'surge', filename!, { ref, path, format, behavior });
      }
    }
  }
  for (const entry of entries.values()) {
    for (const client of ['mihomo', 'surge', 'any'] as const) {
      const choices = entry.variants.filter(v => v.client === client);
      // 文本导入默认优先完整 classical；zydou 用 YAML / RULE-SET，可由现有内核托管合并。
      const score = (v: RepoVariant) => {
        if (repo.adapter === 'zydou') return v.label === 'clash' || v.label === 'surge-rule-set' ? 0 : v.label === 'mrs' ? 3 : 1;
        const base = entry.path.split('/').at(-1)!;
        if (v.label === `${base}_Classical.yaml` || v.label === `${base}_All.list`) return 0;
        if (v.label === `${base}.yaml` || v.label === `${base}.list`) return 1;
        return 2;
      };
      choices.sort((a, b) => score(a) - score(b) || a.id.localeCompare(b.id));
      if (choices[0]) choices[0].recommended = true;
    }
  }
  return [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/** 只读取「使用说明 / 配置建议」段，避免把上游来源中的文件名误当成组合。 */
export function applyReadme(entry: IndexedEntry, client: RepoVariant['client'], readme: string): void {
  const usage = /#### 使用说明\s*([\s\S]*?)(?=#### |## |$)/.exec(readme)?.[1] ?? '';
  for (const variant of entry.variants.filter(v => v.client === client)) {
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
    const parts = names.map(name => entry.variants.find(v => v.client === client && v.files.length === 1 && v.files[0]!.path.split('/').at(-1) === name));
    if (parts.some(p => !p)) continue;
    let variant = parts[0]!;
    if (parts.length > 1) {
      variant = { id: `${client}:组合:${names.join('+')}`, client, label: names.join(' + '), files: parts.flatMap(p => p!.files) };
      if (!entry.variants.some(v => v.id === variant.id)) entry.variants.push(variant);
    }
    first ??= variant;
  }
  if (first) {
    for (const v of entry.variants.filter(v => v.client === client)) v.recommended = v.id === first.id;
  }
}
