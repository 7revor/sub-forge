import { RepositoryModal } from '../components/RepositoryModal.tsx';
// 文件搜索分页读取索引；预览和复制均直达公共仓库原文。
import { Plus, Check, Copy } from 'lucide-react';
import { useClipboard } from '../hooks/useClipboard.ts';
import { nameSearchRanges } from '@sub-forge/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type MouseEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ListTable, ListTableLoading } from '../components/ListTable.tsx';
import { RepositoryManager } from '../components/RepositoryManager.tsx';
import { Pagination } from '../components/Pagination.tsx';
import { Select } from '../components/listbox.tsx';
import { HighlightedText } from '../components/HighlightedText.tsx';
import { SearchInput } from '../components/SearchInput.tsx';
import { useDebouncedValue } from '../hooks/useDebouncedValue.ts';
import { useMe } from '../hooks.ts';
import { api, type RuleOptions, type RuleRepo } from '../api.ts';
import { type RuleSelection } from '../domain/ruleOptions.ts';
import { Button, cx, ErrorAlert, listMono, PageHeader } from '../components/ui.tsx';
import { TableCell, TableRow } from '../components/ui/table.tsx';

type RepositoryFile = Extract<RuleSelection, { source: 'repository' }>;

const FILE_COLUMNS = [
  { header: '文件', width: 160 }, { header: '仓库', width: 390 }, { header: '分支', width: 192 }, { header: '路径', width: 385 },
];

function RepositoryFileLoading({ failed }: { failed: boolean }) {
  return <>
    <div className="list-table-scroll min-h-0 flex-1 overflow-auto overscroll-contain">
      <ListTable label="规则文件" columns={FILE_COLUMNS}>{!failed && <ListTableLoading columns={FILE_COLUMNS.length} rowHeight={45} />}</ListTable>
    </div>
    {failed
      ? <div role="alert" className="shrink-0 border-t px-3 py-2 text-center text-xs text-muted-foreground">仓库加载失败，无法读取文件列表。</div>
      : <Pagination page={1} pageSize={20} total={0} totalPages={1} unknownTotal busy onPage={() => {}} onPageSize={() => {}} />}
  </>;
}

function CopyFileLink({ href, name }: { href: string; name: string }) {
  const clipboard = useClipboard(href);
  const copied = clipboard.status === 'copied';
  return <Button size="icon-sm" variant="ghost" className="absolute right-0 top-1/2 -translate-y-1/2 p-0 opacity-0 group-hover/name:opacity-100 group-focus-within/name:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
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

function RepositoryFileTable({ query, repository, repos }: { query: string; repository: string; repos: RuleRepo[] }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const result = useQuery({
    queryKey: ['repository-files', query, repository, page, pageSize],
    queryFn: () => {
      const params = new URLSearchParams({ scope: 'repository', q: query, offset: String((page - 1) * pageSize), limit: String(pageSize) });
      if (repository) params.set('repository', repository);
      return api<RuleOptions>('GET', `/rule-options/search?${params}`);
    },
  });
  return <>
    <div className="list-table-scroll min-h-0 flex-1 overflow-auto overscroll-contain" aria-busy={result.isFetching}>
      <ListTable label="规则文件" columns={FILE_COLUMNS}>
        {!result.data && !result.error ? <ListTableLoading columns={FILE_COLUMNS.length} rowHeight={45} /> : (result.data?.items ?? []).map(option => {
          const selection = JSON.parse(option.value) as RepositoryFile;
          const repoName = repos.find(repo => repo.id === selection.repo)?.name ?? selection.repo;
          const href = option.url;
          return <TableRow key={option.value} className="cursor-pointer hover:bg-accent focus-within:bg-muted" onClick={event => openFileRow(event, href)} onAuxClick={event => openFileRow(event, href)}>
            <TableCell className="font-medium"><a href={href} target="_blank" rel="noreferrer noopener" className="block truncate text-foreground no-underline hover:text-primary" title={option.label}><HighlightedText text={option.label} matches={option.matches?.label} /></a></TableCell>
            <TableCell className="text-muted-foreground"><span className="block truncate" title={repoName}>{repoName}</span></TableCell>
            <TableCell className="text-muted-foreground">{selection.file.ref}</TableCell>
            <TableCell className={cx(listMono, 'text-xs leading-[normal]')}><span className="group/name relative inline-flex max-w-full items-center pr-8"><a href={href} target="_blank" rel="noreferrer noopener" aria-disabled={!href} className="min-w-0 cursor-pointer break-all rounded-sm text-left no-underline hover:text-primary focus-visible:outline-2 focus-visible:outline-primary" aria-label={`打开 ${selection.file.path}，${repoName}，${selection.file.ref}`}><HighlightedText text={selection.file.path} matches={nameSearchRanges(selection.file.path, query)} /></a>{href && <CopyFileLink href={href} name={selection.file.path} />}</span></TableCell>
          </TableRow>;
        })}
        {result.data?.items.length === 0 && <TableRow className="hover:bg-transparent"><TableCell colSpan={FILE_COLUMNS.length} className="px-5 py-8 text-center text-muted-foreground">没有匹配的规则文件</TableCell></TableRow>}
      </ListTable>
    </div>
    {result.error && <div role="alert" className="px-5 py-2 text-destructive">文件列表加载失败。<Button size="sm" onClick={() => void result.refetch()}>重试</Button></div>}
    {!!result.data?.notices.length && <p role="status" className="px-5 py-2 text-xs text-muted-foreground">{result.data.notices.join('；')}</p>}
    <Pagination page={page} pageSize={pageSize} total={result.data?.total ?? 0} totalPages={Math.max(1, Math.ceil((result.data?.total ?? 0) / pageSize))} unknownTotal={!result.data} busy={result.isFetching} onPage={setPage} onPageSize={size => { setPageSize(size); setPage(1); }} />
  </>;
}

export function RuleRepoPage() {
  const me = useMe();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const ruleset = params.get('ruleset');
  const [q, setQ] = useState(params.get('q') ?? '');
  const query = useDebouncedValue(q.trim(), 250);
  const [repository, setRepository] = useState('');
  const repos = useQuery({ queryKey: ['rule-repos'], queryFn: () => api<{ repos: RuleRepo[] }>('GET', '/rule-repos'), refetchInterval: 3000 });
  const revision = repos.data?.repos.map(repo => `${repo.id}:${repo.builtAt}:${repo.enabled}:${repo.configRevision}`).join('|');
  const pending = q.trim() !== query;
  return <>
    <PageHeader title="规则仓库" actions={me.data?.role === 'admin' && <Button variant="primary" onClick={async () => { const result = await RepositoryModal.show({}); if (result.status === 'confirmed') void qc.invalidateQueries({ queryKey: ['rule-repos'] }); }}><Plus size={16} />添加仓库</Button>}>{repos.data && <span className="text-sm text-muted-foreground">{repos.data.repos.length} 个仓库</span>}</PageHeader>
    <RepositoryManager showAdd={false} repos={repos.data?.repos ?? []} admin={me.data?.role === 'admin'} loading={!repos.data && !repos.error} failed={!!repos.error && !repos.data} onRetry={() => void repos.refetch()} />
    {ruleset && <div className="text-sm text-muted-foreground">点击文件查看源文件；添加来源请返回增强集合。<Link to={`/rulesets/${ruleset}`} className="ml-2 text-primary">返回增强集合</Link></div>}
    <ErrorAlert error={repos.error} />
    <section aria-label="规则文件列表" className="mb-5 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b px-5 py-4">
        <h2 className="m-0 text-base font-semibold">规则文件</h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select clearable aria-label="筛选规则仓库" placeholder="全部仓库" className="w-[200px]" value={repository} onChange={event => setRepository(event.target.value)}>{(repos.data?.repos ?? []).filter(repo => repo.enabled).map(repo => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</Select>
          <SearchInput size="md" className="w-[280px]" aria-label="搜索规则名称或路径" placeholder="按文件名或路径搜索，例如 115.list" value={q} onChange={event => setQ(event.target.value)} />
        </div>
      </div>
      {!pending && repos.data ? <RepositoryFileTable key={`${query}:${repository}:${revision}`} query={query} repository={repository} repos={repos.data.repos} /> : <RepositoryFileLoading failed={!!repos.error && !repos.data} />}
    </section>

  </>;
}
