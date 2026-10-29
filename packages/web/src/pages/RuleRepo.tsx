// 文件搜索分页读取数据库索引，右侧仅预览点击的文件正文。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { RepositoryManager } from '../components/RepositoryManager.tsx';
import { PagedOptionList } from '../components/OptionPage.tsx';
import { CodePreview } from '../components/CodePreview.tsx';
import { useDebouncedValue } from '../hooks/useDebouncedValue.ts';
import { useMe } from '../hooks.ts';
import { api, type RuleRepo, type RepoFilePreview } from '../api.ts';
import { ruleOptionsLoader, type RuleSelection } from '../domain/ruleOptions.ts';
import { Badge, Button, Empty, ErrorAlert, Input, PageHeader } from '../components/ui.tsx';

const loadFiles = ruleOptionsLoader('repository');
type RepositoryFile = Extract<RuleSelection, { source: 'repository' }>;
export function RuleRepoPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const [params] = useSearchParams();
  const ruleset = params.get('ruleset');
  const [q, setQ] = useState(params.get('q') ?? '');
  const query = useDebouncedValue(q.trim(), 250);
  const [selected, setSelected] = useState<RepositoryFile>();
  const repos = useQuery({ queryKey: ['rule-repos'], queryFn: () => api<{ repos: RuleRepo[] }>('GET', '/rule-repos'), refetchInterval: 3000 });
  const revision = repos.data?.repos.map(repo => `${repo.id}:${repo.builtAt}:${repo.enabled}:${repo.configRevision}`).join('|');
  const pending = q.trim() !== query;
  useEffect(() => { setSelected(undefined); }, [query]);
  useEffect(() => {
    if (selected && repos.data && !repos.data.repos.some(repo => repo.id === selected.repo && repo.enabled)) setSelected(undefined);
  }, [repos.data, selected]);
  const preview = useQuery({ queryKey: ['rule-repos', 'file-preview', selected?.repo, selected?.file.ref, selected?.file.path, revision], enabled: !!selected, retry: false,
    queryFn: () => api<{ item: RepoFilePreview }>('GET', `/rule-repos/file-preview?${new URLSearchParams({ repo: selected!.repo, ref: selected!.file.ref, path: selected!.file.path })}`).then(result => result.item),
  });
  const create = useMutation({ meta: { successMessage: ruleset ? '规则文件已加入规则集' : '规则集已创建' },
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
    <PageHeader title="规则仓库" />
    <RepositoryManager repos={repos.data?.repos ?? []} admin={me.data?.role === 'admin'} />
    {ruleset && <div className="text-[13px] text-muted">选择文件预览后可加入规则集。<Link to={`/rulesets/${ruleset}`} className="ml-2 text-accent">返回规则集</Link></div>}
    <div className="flex shrink-0"><Input aria-label="搜索规则名称或路径" placeholder="搜索文件名、仓库或路径" value={q} onChange={event => setQ(event.target.value)} className="h-10 max-w-[440px]" /></div>
    <ErrorAlert error={repos.error} />
    <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[minmax(220px,1fr)_minmax(300px,1.4fr)] gap-5 overflow-y-auto lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
      <section aria-label="规则文件" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[10px] border border-line bg-panel">
        <div className="shrink-0 border-b border-line-2 px-4 py-3 text-[12.5px] text-muted">{pending ? '搜索中…' : !repos.data ? '正在加载…' : '规则文件'}</div>
        {!pending && repos.data && <PagedOptionList key={`${query}:${revision}`} allowUnavailable loadOptions={loadFiles} query={query} selected={selected ? JSON.stringify(selected) : undefined} onSelect={select} />}
      </section>
      <section aria-label="文件内容预览" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[10px] border border-line bg-panel">
        {!selected ? <div className="p-5"><Empty title="选择左侧文件预览内容" /></div> : <>
          <div className="flex shrink-0 flex-col gap-3 border-b border-line-2 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h2 className="m-0 break-all text-[17px] font-semibold">{selected.file.path.split('/').at(-1)}</h2>
              <Badge>分支：{selected.file.ref}</Badge>
            </div>
            <span className="break-all font-mono text-[12px] text-muted">{repos.data?.repos.find(repo => repo.id === selected.repo)?.name ?? selected.repo} · {selected.file.path}</span>
            {file && !preview.isFetching && !preview.isError && <div className="flex flex-wrap items-center gap-3 text-[12px]">
              <Badge>许可证 {file.license}</Badge><a href={file.upstream} target="_blank" rel="noreferrer" className="text-accent">打开原文件</a>
              <Button size="sm" variant="primary" disabled={create.isPending || file.entry === undefined} onClick={() => create.mutate(file)}>{create.isPending ? '创建中…' : ruleset ? '加入规则集' : '新建规则集'}</Button>
            </div>}
            <ErrorAlert error={preview.error ?? create.error} />
            {preview.isError && <Button size="sm" onClick={() => void preview.refetch()}>重试读取文件</Button>}
          </div>
          {preview.isFetching ? <div role="status" className="p-4 text-[13px] text-muted">正在读取文件内容…</div> : file && !preview.isError && <CodePreview label="文件正文" key={`${file.repo}:${file.ref}:${file.path}`} text={file.content} title={file.content ? '文件正文' : '文件正文（空文件）'} copyable fill className="nav-scroll rounded-none" bodyClassName="overscroll-contain p-4 whitespace-pre" />}
        </>}
      </section>
    </div>
  </>;
}
