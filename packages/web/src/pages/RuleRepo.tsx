// 规则仓库（设计稿「规则仓库」）：搜索内置 GitHub 规则仓库、查看按客户端挑选的变体与内容预览，引用为规则集或加入规则包。
// 服务端索引尚未实现：搜索返回空结果并带 pending，引用返回 501。

import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api, type RepoEntry, type RepoEntryDetail, type RuleRepo } from '../api.ts';
import { Badge, Button, buttonClass, Card, ErrorBox, Input, PageHeader, PendingNotice, cx, formatTime, td, th } from '../components/ui.tsx';

export function RuleRepoPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const bundle = params.get('bundle');
  const [q, setQ] = useState(params.get('q') ?? '');
  const [debounced, setDebounced] = useState(q);
  const [repo, setRepo] = useState<string>();
  const [sel, setSel] = useState<RepoEntry>();
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const repos = useQuery({ queryKey: ['rule-repos'], queryFn: () => api<{ pending?: boolean; repos: RuleRepo[] }>('GET', '/rule-repos') });
  const search = useQuery({
    queryKey: ['rule-repos', 'search', debounced, repo],
    queryFn: () => api<{ pending?: boolean; items: RepoEntry[]; total: number }>('GET', `/rule-repos/search?q=${encodeURIComponent(debounced)}${repo ? `&repo=${encodeURIComponent(repo)}` : ''}`),
  });
  const detail = useQuery({
    queryKey: ['rule-repos', 'entry', sel?.repo, sel?.path],
    enabled: !!sel,
    queryFn: () => api<{ item: RepoEntryDetail }>('GET', `/rule-repos/entry?repo=${encodeURIComponent(sel!.repo)}&path=${encodeURIComponent(sel!.path)}`).then((r) => r.item),
  });
  const use = useMutation({
    mutationFn: () => api<{ item: { id: string } }>('POST', '/rule-repos/import', { repo: sel!.repo, path: sel!.path, ...(bundle ? { bundle } : {}) }),
    onSuccess: (r) => navigate(bundle ? `/bundles/${bundle}` : `/rulesets/${r.item.id}`),
  });
  const items = search.data?.items ?? [];
  const pending = repos.data?.pending || search.data?.pending;
  const d = detail.data;

  return (
    <>
      <PageHeader title="规则仓库" subtitle="搜索内置的 GitHub 规则仓库并直接引用。按客户端自动挑选变体；索引每日重建。" />
      {pending && <PendingNotice>规则仓库的索引与搜索还没有接入，搜索暂时没有结果，「引用为规则集」会被拒绝。可以先在规则集里填写远程地址。</PendingNotice>}
      {bundle && <div className="rounded-lg bg-accent-soft px-3 py-2.5 text-[13px] text-accent-ink">选中的规则会加入规则包。<Link to={`/bundles/${bundle}`} className="ml-1 text-accent">返回规则包</Link></div>}
      <div className="flex flex-wrap items-center gap-3">
        <Input aria-label="搜索规则" placeholder="搜索规则名或路径，如 telegram" className="h-10 max-w-[360px]" value={q} onChange={(e) => setQ(e.target.value)} />
        <div role="group" aria-label="仓库" className="flex flex-wrap gap-1.5">
          {[{ id: undefined, name: '全部仓库' }, ...(repos.data?.repos ?? [])].map((r) => (
            <button key={r.id ?? 'all'} type="button" aria-pressed={repo === r.id} onClick={() => setRepo(r.id)}
              className={cx('h-9 cursor-pointer rounded-full border px-3.5 text-[13px]', repo === r.id ? 'border-accent bg-[#f5f8ff] font-medium text-accent-ink' : 'border-[#d5d9e0] bg-panel text-ink-2 hover:bg-ground')}>{r.name}</button>
          ))}
        </div>
      </div>
      <ErrorBox error={repos.error ?? search.error} />

      <div className="flex flex-wrap items-start gap-5">
        <section aria-label="搜索结果" className="min-w-0 flex-[1_1_360px] overflow-hidden rounded-[10px] border border-line bg-panel">
          <div className="border-b border-line-2 px-4 py-3 text-[12.5px] text-muted">{search.isFetching ? '搜索中…' : `${search.data?.total ?? 0} 个结果`}</div>
          {items.map((x) => {
            const on = sel?.repo === x.repo && sel.path === x.path;
            return (
              <button key={`${x.repo}:${x.path}`} type="button" aria-current={on || undefined} onClick={() => setSel(x)}
                className={cx('flex w-full cursor-pointer items-center gap-3 border-b border-line-2 px-4 py-3 text-left last:border-0', on ? 'bg-[#f5f8ff]' : 'hover:bg-ground')}>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="text-[13.5px] font-medium">{x.name}</span><span className="truncate font-mono text-[12px] text-muted">{x.path}</span></span>
                <span className="flex flex-col items-end gap-0.5"><span className="font-mono text-[12.5px]">{x.count}</span><span className="text-[11.5px] text-muted">{x.repo}</span></span>
              </button>
            );
          })}
          {!items.length && !search.isFetching && <div className="px-4 py-6 text-center text-[13px] text-muted">{debounced ? `没有找到「${debounced}」` : '输入关键词开始搜索'}</div>}
        </section>

        <section aria-label="详情" className="flex min-w-0 flex-[999_1_520px] flex-col gap-4 rounded-[10px] border border-line bg-panel px-4.5 py-4">
          {!sel ? <span className="text-[13px] text-muted">从左侧选择一个规则查看详情。</span> : <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <h2 className="m-0 text-[17px] font-semibold">{sel.name}</h2>
                <span className="font-mono text-[12px] text-muted">{sel.repo} · {sel.path}</span>
              </div>
              <Badge>{sel.count} 条</Badge>
            </div>
            <ErrorBox error={detail.error} />
            {d && <>
              <div className="flex flex-wrap gap-2 text-[12.5px]">
                {d.license && <Badge>许可证 {d.license} · 下发时保留来源注释</Badge>}
                {d.updatedAt && <Badge>更新于 {formatTime(d.updatedAt).slice(0, 10)}</Badge>}
              </div>
              <Card title="按客户端选择的变体" bodyClass="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead><tr><th className={th}>客户端</th><th className={th}>文件</th><th className={th}>方式</th></tr></thead>
                  <tbody>{d.variants.map((v) => <tr key={v.client}><td className={cx(td, 'font-medium')}>{v.client}</td><td className={cx(td, 'font-mono text-[12px]')}>{v.file}</td><td className={cx(td, 'text-ink-2')}>{v.how}</td></tr>)}</tbody>
                </table>
              </Card>
              <div className="flex flex-col gap-1.5"><span className="text-[12.5px] font-medium text-muted">内容预览</span>
                <pre className="m-0 max-h-64 overflow-auto rounded-lg bg-nav p-3 font-mono text-[12px] leading-[1.7] text-[#dde1e7]">{d.preview.join('\n')}</pre></div>
            </>}
            <ErrorBox error={use.error} />
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={use.isPending} onClick={() => use.mutate()}>{bundle ? '加入规则包' : '引用为规则集'}</Button>
              {!bundle && <Link to="/bundles" className={buttonClass()}>加入规则包…</Link>}
            </div>
          </>}
        </section>
      </div>
    </>
  );
}
