// 只向调用方返回当前页；旧缓存中的目录节点被过滤，缺少缓存时从已有文件索引降级读取。
import { nameSearchRanges, normalizeNameSearch, type SearchMatch } from '@sub-forge/core';
import type { Store } from '../store.ts';

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

type LocalOption = { id: string; name: string; hint: string };
type Option = { value: string; label: string; hint: string; disabled: boolean; matches: { label: SearchMatch[]; hint: SearchMatch[] } };

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
      repoName || ' · ' || CASE WHEN path = label THEN '/' ELSE substr(path, 1, length(path) - length(label)) END || ' · 分支：' || ref || CASE WHEN entry IS NULL THEN ' · 不可关联' ELSE '' END AS hint,
      substr(label, 1, length(label) - CASE WHEN lower(label) LIKE '%.list' THEN 5 ELSE 4 END) AS name,
      path AS searchable, entry IS NULL AS disabled, path AS filePath, repoName
    FROM named
    UNION ALL
    SELECT json_object('source', 'local', 'id', json_extract(value, '$.id')),
      '本地 · ' || json_extract(value, '$.name'), json_extract(value, '$.hint'), json_extract(value, '$.name'),
      json_extract(value, '$.name') || ' ' || json_extract(value, '$.hint'), 0, NULL, NULL
    FROM json_each(@locals)
  ), matches AS (
    SELECT *, CASE WHEN search_fold(name) = @query THEN 0 WHEN instr(search_fold(name), @query) = 1 THEN 1 ELSE 2 END AS rank
    FROM options WHERE instr(search_fold(searchable), @query) > 0
  )`;
  const params = { locals: JSON.stringify(locals), query: normalizeNameSearch(query) };
  const { total } = db.prepare(`${sql} SELECT count(*) AS total FROM matches`).get(params) as { total: number };
  const rows = db.prepare(`${sql} SELECT value, label, hint, disabled, filePath, repoName FROM matches
    ORDER BY rank, search_fold(name), label, value LIMIT @limit OFFSET @offset`).all({ ...params, offset, limit }) as (Omit<Option, 'disabled' | 'matches'> & { disabled: number; filePath: string | null; repoName: string | null })[];
  const items: Option[] = rows.map(({ filePath, repoName, disabled, ...row }) => {
    if (filePath === null) return { ...row, disabled: !!disabled, matches: { label: nameSearchRanges(row.label, query), hint: nameSearchRanges(row.hint, query) } };
    const directoryLength = filePath.length - row.label.length;
    const ranges = nameSearchRanges(filePath, query);
    return { ...row, disabled: !!disabled, matches: {
      label: projectMatches(ranges, directoryLength, filePath.length, -directoryLength),
      hint: projectMatches(ranges, 0, directoryLength, repoName!.length + ' · '.length),
    } };
  });
  return { items, total, offset, limit, ...(offset + items.length < total ? { nextOffset: offset + items.length } : {}) };
}
