import { useDebouncedValue } from '../hooks/useDebouncedValue.ts';
// 上方管理仓库，下方搜索逻辑条目并按具体文本文件创建关联规则集。

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { RepositoryManager } from '../components/RepositoryManager.tsx';
import { useMe } from '../hooks.ts';
import { api, type RepoEntry, type RepoFileList, type RuleRepo } from '../api.ts';
import { Badge, Button, Card, Empty, ErrorAlert, Input, PageHeader, cx, td, th } from '../components/ui.tsx';

export function RuleRepoPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const [params] = useSearchParams();
  const ruleset = params.get('ruleset');
  const [q, setQ] = useState(params.get('q') ?? '');
  const debounced = useDebouncedValue(q.trim(), 300);
  const [repo, setRepo] = useState<string>();
  const [offset, setOffset] = useState(0);
  const [sel, setSel] = useState<RepoEntry>();
  const repos = useQuery({ queryKey: ['rule-repos'], queryFn: () => api<{ repos: RuleRepo[] }>('GET', '/rule-repos'), refetchInterval: 3000 });
  useEffect(() => {
    if (repos.data && repo && !repos.data.repos.some(r => r.id === repo && r.enabled)) setRepo(undefined);
    if (repos.data && sel && !repos.data.repos.some(r => r.id === sel.repo && r.enabled)) setSel(undefined);
  }, [repos.data, repo, sel]);
  useEffect(() => { setOffset(0); setSel(undefined); }, [debounced, repo]);
  const revision = repos.data?.repos.map(r => `${r.id}:${r.builtAt}:${r.enabled}`).join('|');
  const search = useQuery({
    queryKey: ['rule-repos', 'search', debounced, repo, offset, revision],
    queryFn: () => api<{ items: RepoEntry[]; total: number }>('GET', `/rule-repos/search?q=${encodeURIComponent(debounced)}${repo ? `&repo=${encodeURIComponent(repo)}` : ''}&offset=${offset}`),
  });
  const detail = useQuery({
    queryKey: ['rule-repos', 'files', sel?.repo, sel?.path, revision],
    enabled: !!sel,
    queryFn: () => api<{ item: RepoFileList }>('GET', `/rule-repos/files?repo=${encodeURIComponent(sel!.repo)}&path=${encodeURIComponent(sel!.path)}`).then((r) => r.item),
  });
  const use = useMutation({ meta: { successMessage: '规则文件已加入规则集' },
    mutationFn: (file: { ref: string; path: string }) => api<{ item: { id: string } }>('POST', '/rule-repos/import', { repo: sel!.repo, path: sel!.path, file, ...(ruleset ? { ruleset } : {}) }),
    onSuccess: async (r) => { await qc.invalidateQueries({ queryKey: ['rulesets'] }); navigate(ruleset ? `/rulesets/${ruleset}` : `/rulesets/${r.item.id}`); },
  });
  const repoName = (id: string) => repos.data?.repos.find(r => r.id === id)?.name ?? id;
  const items = search.data?.items ?? [];
  const d = detail.data;

  return (
    <>
      <PageHeader title="规则仓库" />
      <RepositoryManager repos={repos.data?.repos ?? []} admin={me.data?.role === 'admin'} />
      {ruleset && <div className="rounded-lg bg-accent-soft px-3 py-2.5 text-[13px] text-accent-ink">所选文件会作为仓库关联来源加入规则集。<Link to={`/rulesets/${ruleset}`} className="ml-1 text-accent">返回规则集</Link></div>}
      <div className="flex flex-wrap items-center gap-3">
        <Input aria-label="搜索规则" placeholder="搜索规则名或路径，如 telegram" className="h-10 max-w-[360px]" value={q} onChange={(e) => setQ(e.target.value)} />
        <div role="group" aria-label="仓库" className="flex flex-wrap gap-1.5">
          {[{ id: undefined, name: '全部仓库' }, ...(repos.data?.repos.filter(r => r.enabled) ?? [])].map((r) => (
            <button key={r.id ?? 'all'} type="button" aria-pressed={repo === r.id} onClick={() => setRepo(r.id)}
              className={cx('h-9 cursor-pointer rounded-full border px-3.5 text-[13px]', repo === r.id ? 'border-accent bg-[#f5f8ff] font-medium text-accent-ink' : 'border-[#d5d9e0] bg-panel text-ink-2 hover:bg-ground')}>{r.name}</button>
          ))}
        </div>
      </div>
      <ErrorAlert error={repos.error ?? search.error} />

      <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[minmax(240px,1fr)_minmax(320px,1.5fr)] gap-5 overflow-y-auto overscroll-contain lg:grid-cols-[minmax(260px,360px)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
          <section aria-label="搜索结果" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[10px] border border-line bg-panel">
            <div className="shrink-0 border-b border-line-2 px-4 py-3 text-[12.5px] text-muted">{search.isFetching ? '搜索中…' : `${search.data?.total ?? 0} 个结果`}</div>
            <div key={`${debounced}:${repo ?? ''}:${offset}`} aria-label="规则列表" tabIndex={0} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {items.map((x) => {
              const on = sel?.repo === x.repo && sel.path === x.path;
              return (
                <button key={`${x.repo}:${x.path}`} type="button" aria-current={on || undefined} onClick={() => { setSel(x); use.reset(); }}
                  className={cx('flex w-full cursor-pointer items-center gap-3 border-b border-line-2 px-4 py-3 text-left last:border-0', on ? 'bg-[#f5f8ff]' : 'hover:bg-ground')}>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="text-[13.5px] font-medium">{x.name}</span><span className="truncate font-mono text-[12px] text-muted">{x.path}</span></span>
                  <span className="flex flex-col items-end gap-0.5"><span className="text-[11.5px] text-muted">{repoName(x.repo)}</span></span>
                </button>
              );
            })}
            {!items.length && !search.isFetching && <div className="px-4 py-4"><Empty title={debounced ? `没有找到「${debounced}」` : '暂无可用索引，请等待首次更新或联系管理员'} /></div>}
            </div>
            {(search.data?.total ?? 0) > 50 && <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line-2 p-3">
              <Button size="sm" disabled={offset === 0 || search.isFetching} onClick={() => setOffset(Math.max(0, offset - 50))}>上一页</Button>
              <span className="text-[12px] text-muted">第 {Math.floor(offset / 50) + 1} 页</span>
              <Button size="sm" disabled={offset + 50 >= (search.data?.total ?? 0) || search.isFetching} onClick={() => setOffset(offset + 50)}>下一页</Button>
            </div>}
          </section>

          <section key={sel ? `${sel.repo}:${sel.path}` : 'empty'} aria-label="详情" tabIndex={0} className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto overscroll-contain rounded-[10px] border border-line bg-panel px-4.5 py-4 [&>*]:shrink-0">
            {!sel ? <Empty title="还没有选择规则" /> : <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <h2 className="m-0 text-[17px] font-semibold">{sel.name}</h2>
                  <span className="font-mono text-[12px] text-muted">{repoName(sel.repo)} · {sel.path}</span>
                </div>
                {d && <Badge>{d.files.length} 个文件</Badge>}
              </div>
              <ErrorAlert error={detail.error} />
              {detail.isPending && <span className="text-[13px] text-muted">正在读取文件列表…</span>}
              {d && <>
                <div className="flex flex-wrap gap-2 text-[12.5px]">
                  {d.license && <Badge>许可证 {d.license}</Badge>}
                  <a href={d.url} target="_blank" rel="noreferrer" className="text-accent">上游仓库</a>
                </div>
                <Card title="文件列表" bodyClass="!p-0">
                  <table className="w-full table-fixed border-collapse">
                    <thead><tr><th className={th}>文件</th><th className={cx(th, 'w-36')}>操作</th></tr></thead>
                    <tbody>{d.files.map(f => <tr key={JSON.stringify([f.ref, f.path])}>
                      <td className={td}><a className="block break-all font-mono text-[12px] text-accent" href={f.url} target="_blank" rel="noreferrer">{f.path}</a><span className="break-all text-[11.5px] text-muted">分支：{f.ref}</span></td>
                      <td className={td}><Button size="sm" variant="primary" disabled={use.isPending || detail.isFetching} onClick={() => use.mutate({ ref: f.ref, path: f.path })}>{use.isPending && use.variables?.ref === f.ref && use.variables.path === f.path ? '创建中…' : ruleset ? '加入规则集' : '新建规则集'}</Button></td>
                    </tr>)}</tbody>
                  </table>
                  {!d.files.length && <div className="p-4"><Empty title="没有可用的文本文件" /></div>}
                </Card>
              </>}
              <ErrorAlert error={use.error} />

            </>}
          </section>
      </div>
    </>
  );
}
