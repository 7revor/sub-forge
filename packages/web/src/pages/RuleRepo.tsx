import { RefreshCacheButton } from '../components/ResourceCache.tsx';
import { useFileToken, repositoryFileHref } from '../hooks/useFileLink.ts';
// 文件搜索分页读取数据库索引，点击文件在新标签页显示带当前用户 token 的原文。
import { nameSearchRanges } from '@sub-forge/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { RepositoryManager } from '../components/RepositoryManager.tsx';
import { OptionPageStatus, useOptionPages } from '../components/OptionPage.tsx';
import { HighlightedText } from '../components/HighlightedText.tsx';
import { useDebouncedValue } from '../hooks/useDebouncedValue.ts';
import { useMe } from '../hooks.ts';
import { api, type RuleRepo } from '../api.ts';
import { ruleOptionsLoader, type RuleSelection } from '../domain/ruleOptions.ts';
import { Button, ErrorAlert, Input, PageHeader, td, th } from '../components/ui.tsx';

const loadFiles = ruleOptionsLoader('repository', 30);
type RepositoryFile = Extract<RuleSelection, { source: 'repository' }>;

function RepositoryFileTable({ query, repos, onImport, importing, ruleset }: { query: string; repos: RuleRepo[]; onImport: (selection: RepositoryFile) => void; importing: boolean; ruleset: string | null }) {
  const token = useFileToken();
  const page = useOptionPages(loadFiles, query);
  return <>
    <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
      <table aria-label="规则文件" aria-busy={page.isFetching} className="w-full min-w-[640px] border-collapse">
        <thead className="sticky top-0 z-10 bg-panel"><tr>{['文件名', '路径', '仓库', '分支', '操作'].map(label => <th key={label} scope="col" className={th}>{label}</th>)}</tr></thead>
        <tbody>{page.options.map(option => {
          const selection = JSON.parse(option.value) as RepositoryFile;
          const repoName = repos.find(repo => repo.id === selection.repo)?.name ?? selection.repo;
          const href = repositoryFileHref(token, { repo: selection.repo, ...selection.file });
          return <tr key={option.value} className="hover:bg-ground focus-within:bg-ground">
            <td className={td}><a href={href} target="_blank" rel="noreferrer noopener" aria-disabled={!href} className="cursor-pointer rounded-sm text-left font-medium text-ink no-underline hover:text-brand focus-visible:outline-2 focus-visible:outline-brand" aria-label={`打开 ${option.label}，${repoName}，${selection.file.ref}，${selection.file.path}`}><HighlightedText text={option.label} matches={option.matches?.label} /></a></td>
            <td className={`${td} break-all font-mono text-[12px] text-ink-muted`}><HighlightedText text={selection.file.path} matches={nameSearchRanges(selection.file.path, query)} /></td>
            <td className={`${td} text-ink-muted`}>{repoName}</td>
            <td className={`${td} text-ink-muted`}>{selection.file.ref}</td>
            <td className={td}><div className="flex items-center justify-end gap-2 whitespace-nowrap"><Button size="sm" disabled={importing || option.disabled} title={option.disabled ? '此文件暂不支持关联到增强集合' : undefined} onClick={() => onImport(selection)}>{ruleset ? '加入增强集合' : '新建增强集合'}</Button><RefreshCacheButton kind="repository-file" id={selection.file.path} name={option.label} endpoint="/rule-repos/file-refresh" body={{repo:selection.repo,ref:selection.file.ref,path:selection.file.path}}/></div></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <OptionPageStatus page={page} />
  </>;
}

export function RuleRepoPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const [params] = useSearchParams();
  const ruleset = params.get('ruleset');
  const [q, setQ] = useState(params.get('q') ?? '');
  const query = useDebouncedValue(q.trim(), 250);
  const repos = useQuery({ queryKey: ['rule-repos'], queryFn: () => api<{ repos: RuleRepo[] }>('GET', '/rule-repos'), refetchInterval: 3000 });
  const revision = repos.data?.repos.map(repo => `${repo.id}:${repo.builtAt}:${repo.enabled}:${repo.configRevision}`).join('|');
  const pending = q.trim() !== query;
  const importer = useMutation({
    meta: { successMessage: ruleset ? '已加入增强集合' : '增强集合已创建' },
    mutationFn: (selected: RepositoryFile) => api<{ item: { id: string } }>('POST', '/rule-repos/import', { repo: selected.repo, path: selected.entry, file: selected.file, ...(ruleset ? { ruleset } : {}) }),
    onSuccess: async result => { await qc.invalidateQueries({ queryKey: ['rulesets'] }); navigate(`/rulesets/${ruleset ?? result.item.id}`); },
  });
  return <>
    <PageHeader title="规则集合" />
    <RepositoryManager repos={repos.data?.repos ?? []} admin={me.data?.role === 'admin'} />
    {ruleset && <div className="text-[13px] text-ink-muted">点击文件在新标签页查看，可直接加入增强集合。<Link to={`/rulesets/${ruleset}`} className="ml-2 text-brand">返回增强集合</Link></div>}
    <div className="flex shrink-0"><Input aria-label="搜索规则名称或路径" placeholder="搜索文件名或路径" value={q} onChange={event => setQ(event.target.value)} className="h-10 max-w-[440px]" /></div>
    <ErrorAlert error={repos.error} />
    <section aria-label="规则文件列表" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[10px] border border-line bg-panel">
      <div className="shrink-0 border-b border-line-2 px-4 py-3 text-[12.5px] text-ink-muted">{pending ? '搜索中…' : !repos.data ? '正在加载…' : '规则文件'}</div>
      {!pending && repos.data && <RepositoryFileTable key={`${query}:${revision}`} query={query} repos={repos.data.repos} onImport={selection => importer.mutate(selection)} importing={importer.isPending} ruleset={ruleset} />}
    </section>

  </>;
}
