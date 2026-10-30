import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog.tsx';
// 文件搜索分页读取数据库索引，点击表格中的文件后弹窗预览原文。
import { nameSearchRanges } from '@sub-forge/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { RepositoryManager } from '../components/RepositoryManager.tsx';
import { OptionPageStatus, useOptionPages } from '../components/OptionPage.tsx';
import { CodePreview } from '../components/CodePreview.tsx';
import { HighlightedText } from '../components/HighlightedText.tsx';
import { useDebouncedValue } from '../hooks/useDebouncedValue.ts';
import { useDialogDraft } from '../hooks/useDialogDraft.ts';
import { useMe } from '../hooks.ts';
import { api, type RuleRepo, type RepoFilePreview } from '../api.ts';
import { ruleOptionsLoader, type RuleSelection } from '../domain/ruleOptions.ts';
import { Badge, Button, ErrorAlert, Input, PageHeader, td, th } from '../components/ui.tsx';

const loadFiles = ruleOptionsLoader('repository');
type RepositoryFile = Extract<RuleSelection, { source: 'repository' }>;

function RepositoryFileTable({ query, repos, onSelect }: { query: string; repos: RuleRepo[]; onSelect: (value: string) => void }) {
  const page = useOptionPages(loadFiles, query);
  return <>
    <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
      <table aria-label="规则文件" aria-busy={page.isFetching} className="w-full min-w-[640px] border-collapse">
        <thead className="sticky top-0 z-10 bg-panel"><tr>{['文件名', '路径', '仓库', '分支'].map(label => <th key={label} scope="col" className={th}>{label}</th>)}</tr></thead>
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
  const [selected, setSelected] = useState<RepositoryFile>();
  const [dialogFile] = useDialogDraft(!!selected, selected, selected ? `${selected.repo}:${selected.file.ref}:${selected.file.path}` : undefined);
  const repos = useQuery({ queryKey: ['rule-repos'], queryFn: () => api<{ repos: RuleRepo[] }>('GET', '/rule-repos'), refetchInterval: 3000 });
  const revision = repos.data?.repos.map(repo => `${repo.id}:${repo.builtAt}:${repo.enabled}:${repo.configRevision}`).join('|');
  const pending = q.trim() !== query;
  useEffect(() => { setSelected(undefined); }, [query]);
  useEffect(() => {
    if (selected && repos.data && !repos.data.repos.some(repo => repo.id === selected.repo && repo.enabled)) setSelected(undefined);
  }, [repos.data, selected]);
  const preview = useQuery({ queryKey: ['rule-repos', 'file-preview', dialogFile?.repo, dialogFile?.file.ref, dialogFile?.file.path, revision], enabled: !!selected, retry: false,
    queryFn: () => api<{ item: RepoFilePreview }>('GET', `/rule-repos/file-preview?${new URLSearchParams({ repo: dialogFile!.repo, ref: dialogFile!.file.ref, path: dialogFile!.file.path })}`).then(result => result.item),
  });
  const create = useMutation({ meta: { successMessage: ruleset ? '规则文件已加入增强集合' : '增强集合已创建' },
    mutationFn: (file: RepoFilePreview) => api<{ item: { id: string } }>('POST', '/rule-repos/import', { repo: file.repo, path: file.entry, file: { ref: file.ref, path: file.path }, ...(ruleset ? { ruleset } : {}) }),
    onSuccess: async result => { await qc.invalidateQueries({ queryKey: ['rulesets'] }); navigate(ruleset ? `/rulesets/${ruleset}` : `/rulesets/${result.item.id}`); },
  });
  const select = (value: string) => {
    const selection = JSON.parse(value) as RuleSelection;
    if (selection.source !== 'repository') throw new Error('请选择仓库文件');
    setSelected(selection); create.reset();
  };
  const file = preview.data;
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
    <Dialog open={!!selected} onOpenChange={next => { if (!next) (() => setSelected(undefined))(); }}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl" aria-describedby={undefined}><DialogHeader><DialogTitle>{"文件内容预览"}</DialogTitle></DialogHeader><div className="flex min-h-0 flex-col gap-3.5">
      {dialogFile && <>
        <div className="flex shrink-0 flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="m-0 break-all text-[17px] font-semibold">{dialogFile.file.path.split('/').at(-1)}</h2>
            <Badge>分支：{dialogFile.file.ref}</Badge>
          </div>
          <span className="break-all font-mono text-[12px] text-ink-muted">{repos.data?.repos.find(repo => repo.id === dialogFile.repo)?.name ?? dialogFile.repo} · {dialogFile.file.path}</span>
          {file && !preview.isFetching && !preview.isError && <div className="flex flex-wrap items-center gap-3 text-[12px]">
            <Badge>许可证 {file.license}</Badge><a href={file.upstream} target="_blank" rel="noreferrer" className="text-brand">打开原文件</a>
            <Button size="sm" variant="primary" disabled={create.isPending || file.entry === undefined} onClick={() => create.mutate(file)}>{create.isPending ? '创建中…' : ruleset ? '加入增强集合' : '新建增强集合'}</Button>
          </div>}
          <ErrorAlert error={preview.error ?? create.error} />
          {preview.isError && <Button size="sm" onClick={() => void preview.refetch()}>重试读取文件</Button>}
        </div>
        {preview.isFetching ? <div role="status" className="p-4 text-[13px] text-ink-muted">正在读取文件内容…</div> : file && !preview.isError && <CodePreview label="文件正文" key={`${file.repo}:${file.ref}:${file.path}`} text={file.content} title={file.content ? '文件正文' : '文件正文（空文件）'} copyable className="nav-scroll shrink-0" bodyClassName="overscroll-contain p-4 whitespace-pre" />}
      </>}
    </div></DialogContent></Dialog>
  </>;
}
