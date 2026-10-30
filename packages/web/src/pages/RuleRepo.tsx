import { RefreshCacheButton } from '../components/ResourceCache.tsx';
import { createModal, useModalDraft, useModalPresentation, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '../modals/index.tsx';
// 文件搜索分页读取数据库索引，点击表格中的文件后弹窗预览原文。
import { nameSearchRanges } from '@sub-forge/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { RepositoryManager } from '../components/RepositoryManager.tsx';
import { OptionPageStatus, useOptionPages } from '../components/OptionPage.tsx';
import { CodePreview } from '../components/CodePreview.tsx';
import { HighlightedText } from '../components/HighlightedText.tsx';
import { useDebouncedValue } from '../hooks/useDebouncedValue.ts';
import { useMe } from '../hooks.ts';
import { api, type RuleRepo, type RepoFilePreview } from '../api.ts';
import { ruleOptionsLoader, type RuleSelection } from '../domain/ruleOptions.ts';
import { Badge, Button, ErrorAlert, Input, PageHeader, formatTime, td, th } from '../components/ui.tsx';

const loadFiles = ruleOptionsLoader('repository');
type RepositoryFile = Extract<RuleSelection, { source: 'repository' }>;

function RepositoryFileTable({ query, repos, onSelect }: { query: string; repos: RuleRepo[]; onSelect: (value: string) => void }) {
  const page = useOptionPages(loadFiles, query);
  return <>
    <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
      <table aria-label="规则文件" aria-busy={page.isFetching} className="w-full min-w-[640px] border-collapse">
        <thead className="sticky top-0 z-10 bg-panel"><tr>{['文件名', '路径', '仓库', '分支', '操作'].map(label => <th key={label} scope="col" className={th}>{label}</th>)}</tr></thead>
        <tbody>{page.options.map(option => {
          const selection = JSON.parse(option.value) as RepositoryFile;
          const repoName = repos.find(repo => repo.id === selection.repo)?.name ?? selection.repo;
          return <tr key={option.value} className="cursor-pointer hover:bg-ground focus-within:bg-ground" onClick={event => {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            if (event.target instanceof Element && event.target.closest('button')) return;
            if (!window.getSelection()?.toString()) onSelect(option.value);
          }}>
            <td className={td}><button type="button" className="cursor-pointer rounded-sm text-left font-medium text-ink hover:text-brand focus-visible:outline-2 focus-visible:outline-brand" aria-label={`预览 ${option.label}，${repoName}，${selection.file.ref}，${selection.file.path}`} onClick={() => onSelect(option.value)}><HighlightedText text={option.label} matches={option.matches?.label} /></button></td>
            <td className={`${td} break-all font-mono text-[12px] text-ink-muted`}><HighlightedText text={selection.file.path} matches={nameSearchRanges(selection.file.path, query)} /></td>
            <td className={`${td} text-ink-muted`}>{repoName}</td>
            <td className={`${td} text-ink-muted`}>{selection.file.ref}</td>
            <td className={td}><RefreshCacheButton kind="repository-file" id={selection.file.path} name={option.label} endpoint="/rule-repos/file-refresh" body={{repo:selection.repo,ref:selection.file.ref,path:selection.file.path}}/></td>
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
  const select = async (value: string) => {
    const selected = JSON.parse(value) as RuleSelection;
    if (selected.source !== 'repository') throw new Error('请选择仓库文件');
    const result = await RepositoryPreviewModal.show({ selected, ruleset, repos: repos.data?.repos ?? [] });
    if (result.status === 'confirmed') { await qc.invalidateQueries({ queryKey: ['rulesets'] }); navigate(`/rulesets/${result.data}`); }
  };
  return <>
    <PageHeader title="规则集合" />
    <RepositoryManager repos={repos.data?.repos ?? []} admin={me.data?.role === 'admin'} />
    {ruleset && <div className="text-[13px] text-ink-muted">选择文件预览后可加入增强集合。<Link to={`/rulesets/${ruleset}`} className="ml-2 text-brand">返回增强集合</Link></div>}
    <div className="flex shrink-0"><Input aria-label="搜索规则名称或路径" placeholder="搜索文件名或路径" value={q} onChange={event => setQ(event.target.value)} className="h-10 max-w-[440px]" /></div>
    <ErrorAlert error={repos.error} />
    <section aria-label="规则文件列表" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[10px] border border-line bg-panel">
      <div className="shrink-0 border-b border-line-2 px-4 py-3 text-[12.5px] text-ink-muted">{pending ? '搜索中…' : !repos.data ? '正在加载…' : '规则文件'}</div>
      {!pending && repos.data && <RepositoryFileTable key={`${query}:${revision}`} query={query} repos={repos.data.repos} onSelect={select} />}
    </section>

  </>;
}

const RepositoryPreviewModal = createModal<{ selected: RepositoryFile; ruleset: string | null; repos: RuleRepo[] }, string>(function RepositoryPreview({ data: { selected, ruleset, repos }, modal }) {
  const query = useQuery({ queryKey: ['rule-repos', 'file-preview', selected.repo, selected.file.ref, selected.file.path], enabled: modal.active, retry: false,
    queryFn: () => api<{ item: RepoFilePreview }>('GET', `/rule-repos/file-preview?${new URLSearchParams({ repo: selected.repo, ref: selected.file.ref, path: selected.file.path })}`).then(result => result.item),
  });
  const preview = useModalPresentation(query);
  const file = preview.data;
  return <ModalContent className="flex h-[min(640px,calc(100dvh-2rem))] min-w-0 flex-col overflow-hidden sm:max-w-[800px] [&>*]:min-w-0" style={{ width: 'min(800px, calc(100vw - 2rem))' }} aria-describedby={undefined}><ModalHeader className="shrink-0"><ModalTitle>{"文件内容预览"}</ModalTitle></ModalHeader><div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3.5 overflow-hidden">
      {selected && <>
        <div className="flex shrink-0 flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="m-0 break-all text-[17px] font-semibold">{selected.file.path.split('/').at(-1)}</h2>
            <Badge>分支：{selected.file.ref}</Badge>
          </div>
          <span className="line-clamp-2 break-all font-mono text-[12px] text-ink-muted">{repos.find(repo => repo.id === selected.repo)?.name ?? selected.repo} · {selected.file.path}</span>
          {file && !preview.isFetching && !preview.isError && <div className="flex flex-wrap items-center gap-3 text-[12px]">
            <Badge>许可证 {file.license}</Badge><a href={file.upstream} target="_blank" rel="noreferrer" className="text-brand">打开原文件</a>
            <Button size="sm" variant="primary" disabled={modal.pending || file.entry === undefined} onClick={() => modal.submit(async () => { const result = await api<{ item: { id: string } }>('POST', '/rule-repos/import', { repo: file.repo, path: file.entry, file: { ref: file.ref, path: file.path }, ...(ruleset ? { ruleset } : {}) }); return ruleset ?? result.item.id; })}>{modal.pending ? '创建中…' : ruleset ? '加入增强集合' : '新建增强集合'}</Button>
          </div>}
          {file?.cache?.error && !preview.isFetching && <p role="status" className="text-[13px] text-amber-700">拉取失败：{file.cache.error}；正在显示上次成功内容（{file.cache.lastSuccessAt ? formatTime(file.cache.lastSuccessAt) : '时间未知'}）。</p>}
          <ErrorAlert error={preview.error} />
          {preview.isError && <Button size="sm" onClick={() => void preview.refetch()}>重试读取文件</Button>}
        </div>
        {preview.isFetching ? <div role="status" className="p-4 text-[13px] text-ink-muted">正在读取文件内容…</div> : file && !preview.isError && <CodePreview label="文件正文" key={`${file.repo}:${file.ref}:${file.path}`} text={file.content} fill className="nav-scroll" bodyClassName="overscroll-contain p-4 whitespace-pre" />}
      </>}
    </div></ModalContent>;
});
