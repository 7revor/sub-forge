// 只向调用方返回当前页；旧缓存中的目录节点被过滤，缺少缓存时从已有文件索引降级读取。
import { nameSearchRanges, normalizeNameSearch, normalizeRuleUrl, type SearchMatch } from '@sub-forge/core';
import type { Store } from '../store.ts';
import { rawUrl, type RepoDefinition } from './adapters.ts';

const filesSql = `WITH files AS (
  SELECT c.repo, json_extract(n.value, '$.ref') AS ref, json_extract(n.value, '$.path') AS path,
    json_extract(n.value, '$.entry') AS entry
  FROM rule_repo_catalog c JOIN rule_repos r ON r.id = c.repo, json_each(c.data) n
  WHERE r.enabled = 1 AND json_extract(n.value, '$.kind') = 'file'
  UNION
  SELECT e.repo, json_extract(f.value, '$.ref'), json_extract(f.value, '$.path'), e.key
  FROM rule_repo_entries e JOIN rule_repos r ON r.id = e.repo,
    json_each(e.data, '$.variants') v, json_each(v.value, '$.files') f
  WHERE r.enabled = 1 AND NOT EXISTS (SELECT 1 FROM rule_repo_catalog c WHERE c.repo = e.repo)
    AND (lower(json_extract(f.value, '$.path')) LIKE '%.list' OR lower(json_extract(f.value, '$.path')) LIKE '%.txt')
)`;

export function findRuleFile(db: Store['db'], repo: string, ref: string, path: string) {
  return db.prepare(`${filesSql} SELECT entry FROM files WHERE repo = ? AND ref = ? AND path = ? LIMIT 1`).get(repo, ref, path) as { entry: string | null } | undefined;
}

export type MatchedRuleFile = { repo: string; entry: string; ref: string; path: string; label: string; hint: string };

/** 只匹配已启用、可关联的索引文件；URL 全等避免将单文件扩展为整个规则集。 */
export function matchRuleFileUrls(db: Store['db'], input: string[]): Record<string, MatchedRuleFile[]> {
  const urls = new Set(input.map(normalizeRuleUrl));
  const matches: Record<string, MatchedRuleFile[]> = {};
  if (!urls.size) return matches;
  const repos = db.prepare('SELECT id, COALESCE(indexed_definition, definition) AS definition FROM rule_repos WHERE enabled = 1').all() as { id: string; definition: string }[];
  for (const row of repos) {
    const definition = JSON.parse(row.definition) as RepoDefinition;
    const prefix = `https://raw.githubusercontent.com/${definition.owner}/${definition.repo}/`;
    if (![...urls].some(url => url.startsWith(prefix))) continue;
    const files = db.prepare(`${filesSql} SELECT ref, path, entry FROM files WHERE repo = ? AND entry IS NOT NULL`).all(row.id) as { ref: string; path: string; entry: string }[];
    for (const file of files) {
      const url = rawUrl(definition, { ...file, format: 'auto' });
      if (!urls.has(url)) continue;
      const label = file.path.split('/').at(-1)!;
      (matches[url] ??= []).push({ repo: row.id, entry: file.entry, ref: file.ref, path: file.path, label, hint: `${definition.name} · ${file.ref} · ${file.path}` });
    }
  }
  for (const candidates of Object.values(matches)) candidates.sort((a, b) => a.hint.localeCompare(b.hint));
  return matches;
}

type LocalOption = { id: string; name: string; hint: string };
type Option = { value: string; label: string; hint: string; url?: string; disabled: boolean; matches: { label: SearchMatch[]; hint: SearchMatch[] } };

const projectMatches = (ranges: SearchMatch[], start: number, end: number, offset: number): SearchMatch[] => ranges
  .filter(range => range.start < end && range.end > start)
  .map(range => ({ start: Math.max(range.start, start) + offset, end: Math.min(range.end, end) + offset }));
export function searchRuleOptions(db: Store['db'], locals: LocalOption[], query: string, offset: number, limit: number) {
  // 仓库名与分支仅作来源说明，避免 domain 中的 ai 等公共片段命中整库。
  const sql = `${filesSql}, named AS (
    SELECT f.*, json_extract(r.definition, '$.name') AS repoName,
      substr(path, length(rtrim(path, replace(path, '/', ''))) + 1) AS label
    FROM files f JOIN rule_repos r ON r.id = f.repo
  ), options AS (
    SELECT json_object('source', 'repository', 'repo', repo, 'entry', coalesce(entry, ''),
      'file', json_object('ref', ref, 'path', path)) AS value, label,
      '' AS hint,
      substr(label, 1, length(label) - CASE WHEN lower(label) LIKE '%.list' THEN 5 ELSE 4 END) AS name,
      path AS searchable, entry IS NULL AS disabled, path AS filePath, repoName, repo, ref
    FROM named
    UNION ALL
    SELECT json_object('source', 'local', 'id', json_extract(value, '$.id')),
      '本地 · ' || json_extract(value, '$.name'), json_extract(value, '$.hint'), json_extract(value, '$.name'),
      json_extract(value, '$.name') || ' ' || json_extract(value, '$.hint'), 0, NULL, NULL, NULL, NULL
    FROM json_each(@locals)
  ), matches AS (
    SELECT *, CASE WHEN search_fold(name) = @query THEN 0 WHEN instr(search_fold(name), @query) = 1 THEN 1 ELSE 2 END AS rank
    FROM options WHERE instr(search_fold(searchable), @query) > 0
  ), branch_counts AS (
    SELECT repo, count(DISTINCT ref) AS branches FROM matches WHERE repo IS NOT NULL GROUP BY repo
  )`;
  const params = { locals: JSON.stringify(locals), query: normalizeNameSearch(query) };
  const { total } = db.prepare(`${sql} SELECT count(*) AS total FROM matches`).get(params) as { total: number };
  // 按完整匹配集统计分支，再取当前页；避免跨页的另一分支加载后才改变已显示的说明。
  const rows = db.prepare(`${sql} SELECT m.value, m.label, m.hint, m.disabled, m.filePath, m.repoName, m.ref, b.branches
    FROM matches m LEFT JOIN branch_counts b ON b.repo = m.repo
    ORDER BY m.rank, search_fold(m.name), m.label, m.value LIMIT @limit OFFSET @offset`).all({ ...params, offset, limit }) as
    (Omit<Option, 'disabled' | 'matches'> & { disabled: number; filePath: string | null; repoName: string | null; ref: string | null; branches: number | null })[];
  const definitions = new Map((db.prepare('SELECT id, COALESCE(indexed_definition, definition) AS definition FROM rule_repos WHERE enabled = 1').all() as { id: string; definition: string }[])
    .map(row => [row.id, JSON.parse(row.definition) as RepoDefinition]));
  const items: Option[] = rows.map(({ filePath, repoName, ref, branches, disabled, ...row }) => {
    if (filePath === null) return { ...row, disabled: !!disabled, matches: { label: nameSearchRanges(row.label, query), hint: nameSearchRanges(row.hint, query) } };
    const directoryLength = filePath.length - row.label.length;
    const ranges = nameSearchRanges(filePath, query);
    const separator = branches! > 1 ? ' * ' : ' · ';
    const origin = branches! > 1 ? `${repoName}${separator}${ref}` : repoName!;
    const directory = filePath.slice(0, directoryLength);
    const hint = directory ? `${origin}${separator}${directory}` : origin;
    const { repo } = JSON.parse(row.value) as { repo: string };
    // 预览与复制直接使用索引所属公共仓库的分支原文地址，不发行托管链接。
    const url = rawUrl(definitions.get(repo)!, { ref: ref!, path: filePath, format: 'auto' });
    return { ...row, hint, url, disabled: !!disabled, matches: {
      label: projectMatches(ranges, directoryLength, filePath.length, -directoryLength),
      hint: projectMatches(ranges, 0, directoryLength, origin.length + separator.length),
    } };
  });
  return { items, total, offset, limit, ...(offset + items.length < total ? { nextOffset: offset + items.length } : {}) };
}
