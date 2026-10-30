// 文件搜索分页读取索引；预览和复制均直达公共仓库原文。
import { Check, Copy } from 'lucide-react';
import { useClipboard } from '../hooks/useClipboard.ts';
import { nameSearchRanges } from '@sub-forge/core';
import { useQuery } from '@tanstack/react-query';
import { useState, type MouseEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ListTable, ListTableLoading } from '../components/ListTable.tsx';
import { RepositoryManager } from '../components/RepositoryManager.tsx';
import { OptionPageStatus, useOptionPages } from '../components/OptionPage.tsx';
import { HighlightedText } from '../components/HighlightedText.tsx';
import { useDebouncedValue } from '../hooks/useDebouncedValue.ts';
import { useMe } from '../hooks.ts';
import { api, type RuleRepo } from '../api.ts';
import { ruleOptionsLoader, type RuleSelection } from '../domain/ruleOptions.ts';
import { Button, ErrorAlert, Input, PageHeader, td } from '../components/ui.tsx';

const loadFiles = ruleOptionsLoader('repository', 30);
type RepositoryFile = Extract<RuleSelection, { source: 'repository' }>;

const FILE_COLUMNS = [
  { header: '仓库', width: 220 }, { header: '分支', width: 160 }, { header: '路径', width: 440 },
  { header: '文件名', width: 220 },
];

function RepositoryFileLoading({ failed }: { failed: boolean }) {
  return <>
    <div className="list-table-scroll min-h-0 flex-1 overflow-auto overscroll-contain">
      <ListTable label="规则文件" columns={FILE_COLUMNS}>{!failed && <ListTableLoading columns={FILE_COLUMNS.length} rowHeight={53} />}</ListTable>
    </div>
    <div role="status" className="shrink-0 border-t border-line-2 px-3 py-2 text-center text-[12px] text-ink-muted">{failed ? '仓库加载失败，无法读取文件列表。' : '正在加载…'}</div>
  </>;
}

function CopyFileLink({ href, name }: { href: string; name: string }) {
  const clipboard = useClipboard(href);
  const copied = clipboard.status === 'copied';
  return <Button size="sm" variant="ghost" className="size-8 shrink-0 p-0 opacity-0 group-hover/name:opacity-100 group-focus-within/name:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
    aria-label={`复制 ${name} 的源文件链接`} title={copied ? '已复制' : '复制公共仓库 raw 地址'} disabled={clipboard.status === 'pending'}
    onClick={event => { event.stopPropagation(); void clipboard.copy(); }}>
    {copied ? <Check size={14} /> : <Copy size={14} />}<span className="sr-only" role="status">{copied ? '已复制' : ''}</span>
  </Button>;
}

function openFileRow(event: MouseEvent<HTMLTableRowElement>, href?: string) {
  if (!href || event.defaultPrevented || ![0, 1].includes(event.button)) return;
  if (event.target instanceof Element && event.target.closest('a, button, input, select, textarea, [role="button"], [contenteditable]')) return;
  if (window.getSelection()?.toString()) return;
  event.preventDefault();
  window.open(href, '_blank', 'noopener,noreferrer');
}

function RepositoryFileTable({ query, repos }: { query: string; repos: RuleRepo[] }) {
  const page = useOptionPages(loadFiles, query);
  return <>
    <div className="list-table-scroll min-h-0 flex-1 overflow-auto overscroll-contain" aria-busy={page.isFetching}>
      <ListTable label="规则文件" columns={FILE_COLUMNS}>
        {!page.data && !page.error ? <ListTableLoading columns={FILE_COLUMNS.length} rowHeight={53} /> : page.options.map(option => {
          const selection = JSON.parse(option.value) as RepositoryFile;
          const repoName = repos.find(repo => repo.id === selection.repo)?.name ?? selection.repo;
          const href = option.url;
          return <tr key={option.value} className="cursor-pointer hover:bg-ground focus-within:bg-ground" onClick={event => openFileRow(event, href)} onAuxClick={event => openFileRow(event, href)}>
            <td className={`${td} text-ink-muted`}>{repoName}</td>
            <td className={`${td} text-ink-muted`}>{selection.file.ref}</td>
            <td className={`${td} break-all font-mono text-[12px] text-ink-muted`}><HighlightedText text={selection.file.path} matches={nameSearchRanges(selection.file.path, query)} /></td>
            <td className={td}><span className="group/name inline-flex max-w-full items-center gap-1"><a href={href} target="_blank" rel="noreferrer noopener" aria-disabled={!href} className="cursor-pointer rounded-sm text-left font-medium text-ink no-underline hover:text-brand focus-visible:outline-2 focus-visible:outline-brand" aria-label={`打开 ${option.label}，${repoName}，${selection.file.ref}，${selection.file.path}`}><HighlightedText text={option.label} matches={option.matches?.label} /></a>{href && <CopyFileLink href={href} name={option.label} />}</span></td>
          </tr>;
        })}
      </ListTable>
    </div>
    <OptionPageStatus page={page} />
  </>;
}

export function RuleRepoPage() {
  const me = useMe();
  const [params] = useSearchParams();
  const ruleset = params.get('ruleset');
  const [q, setQ] = useState(params.get('q') ?? '');
  const query = useDebouncedValue(q.trim(), 250);
  const repos = useQuery({ queryKey: ['rule-repos'], queryFn: () => api<{ repos: RuleRepo[] }>('GET', '/rule-repos'), refetchInterval: 3000 });
  const revision = repos.data?.repos.map(repo => `${repo.id}:${repo.builtAt}:${repo.enabled}:${repo.configRevision}`).join('|');
  const pending = q.trim() !== query;
  return <>
    <PageHeader title="规则集合" />
    <RepositoryManager repos={repos.data?.repos ?? []} admin={me.data?.role === 'admin'} loading={!repos.data && !repos.error} failed={!!repos.error && !repos.data} onRetry={() => void repos.refetch()} />
    {ruleset && <div className="text-[13px] text-ink-muted">点击文件查看源文件；添加来源请返回增强集合。<Link to={`/rulesets/${ruleset}`} className="ml-2 text-brand">返回增强集合</Link></div>}
    <div className="flex shrink-0"><Input aria-label="搜索规则名称或路径" placeholder="搜索文件名或路径" value={q} onChange={event => setQ(event.target.value)} className="h-10 max-w-[440px]" /></div>
    <ErrorAlert error={repos.error} />
    <section aria-label="规则文件列表" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[10px] border border-line bg-panel">
      <div className="shrink-0 border-b border-line-2 px-4 py-3 text-[12.5px] text-ink-muted">{pending ? '搜索中…' : !repos.data ? '正在加载…' : '规则文件'}</div>
      {!pending && repos.data ? <RepositoryFileTable key={`${query}:${revision}`} query={query} repos={repos.data.repos} /> : <RepositoryFileLoading failed={!!repos.error && !repos.data} />}
    </section>

  </>;
}
