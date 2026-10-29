import { useDebouncedValue } from '../hooks/useDebouncedValue.ts';
import { RejectedRulesPopover } from '../components/RejectedRulesPopover.tsx';
import { CodePreview } from '../components/CodePreview.tsx';
// 规则仓库（设计稿「规则仓库」）：搜索内置及自定义 GitHub 规则仓库、查看按客户端挑选的变体与内容预览，引用为规则集或作为远程来源加入已有规则集。

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Select } from '../components/listbox.tsx';
import { useMe } from '../hooks.ts';
import { api, type RepoEntry, type RepoEntryDetail, type RuleRepo } from '../api.ts';
import { Badge, Button, buttonClass, Card, Empty, ErrorBox, Input, PageHeader, PageScroll, cx, td, th } from '../components/ui.tsx';

const clientLabel = (client: string) => client === 'any' ? '通用文本' : client;

export function RuleRepoPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const [params] = useSearchParams();
  const ruleset = params.get('ruleset');
  const [q, setQ] = useState(params.get('q') ?? '');
  const debounced = useDebouncedValue(q.trim(), 300);
  const [repo, setRepo] = useState<string>();
  const [client, setClient] = useState('');
  const [offset, setOffset] = useState(0);
  const [variant, setVariant] = useState('');
  const [sel, setSel] = useState<RepoEntry>();
  const repos = useQuery({ queryKey: ['rule-repos'], queryFn: () => api<{ repos: RuleRepo[] }>('GET', '/rule-repos'), refetchInterval: 3000 });
  useEffect(() => {
    if (repos.data && repo && !repos.data.repos.some(r => r.id === repo && r.enabled)) setRepo(undefined);
    if (repos.data && sel && !repos.data.repos.some(r => r.id === sel.repo && r.enabled)) setSel(undefined);
  }, [repos.data, repo, sel]);
  const refresh = useMutation({ mutationFn: (id: string) => api('POST', `/rule-repos/${id}/refresh`), onSuccess: () => qc.invalidateQueries({ queryKey: ['rule-repos'] }) });
  useEffect(() => { setOffset(0); setSel(undefined); setVariant(''); }, [debounced, repo, client]);
  const revision = repos.data?.repos.map(r => `${r.id}:${r.builtAt}:${r.enabled}`).join('|');
  const search = useQuery({
    queryKey: ['rule-repos', 'search', debounced, repo, client, offset, revision],
    queryFn: () => api<{ items: RepoEntry[]; total: number }>('GET', `/rule-repos/search?q=${encodeURIComponent(debounced)}${repo ? `&repo=${encodeURIComponent(repo)}` : ''}&client=${client}&offset=${offset}`),
  });
  const detail = useQuery({
    queryKey: ['rule-repos', 'entry', sel?.repo, sel?.path, revision],
    enabled: !!sel,
    queryFn: () => api<{ item: RepoEntryDetail }>('GET', `/rule-repos/entry?repo=${encodeURIComponent(sel!.repo)}&path=${encodeURIComponent(sel!.path)}`).then((r) => r.item),
  });
  const use = useMutation({
    mutationFn: () => api<{ item: { id: string } }>('POST', '/rule-repos/import', { repo: sel!.repo, path: sel!.path, ...(variant ? { variant } : {}), ...(ruleset ? { ruleset } : {}) }),
    onSuccess: async (r) => { await qc.invalidateQueries({ queryKey: ['rulesets'] }); navigate(ruleset ? `/rulesets/${ruleset}` : `/rulesets/${r.item.id}`); },
  });
  const repoName = (id: string) => repos.data?.repos.find(r => r.id === id)?.name ?? id;
  const items = search.data?.items ?? [];
  const d = detail.data;

  return (
    <>
      <PageHeader title="规则仓库" />
      <div className="flex flex-wrap gap-2" aria-label="索引状态">
        {(repos.data?.repos ?? []).map(r => <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-[12px]">
          <span>{r.name} · {!r.enabled ? '已停用' : r.indexing ? '正在更新索引…' : r.builtAt ? `${r.entries} 个规则` : '等待首次索引'}</span>
          {r.error && <span className="text-err">{r.error}{r.builtAt ? '（继续使用上次索引）' : ''}</span>}
          {me.data?.role === 'admin' && r.enabled && <Button size="sm" disabled={r.indexing || refresh.isPending} onClick={() => refresh.mutate(r.id)}>更新索引</Button>}
        </div>)}
      </div>
      <ErrorBox error={refresh.error} />
      {ruleset && <div className="rounded-lg bg-accent-soft px-3 py-2.5 text-[13px] text-accent-ink">选中的规则会作为远程来源加入规则集。<Link to={`/rulesets/${ruleset}`} className="ml-1 text-accent">返回规则集</Link></div>}
      <div className="flex flex-wrap items-center gap-3">
        <Input aria-label="搜索规则" placeholder="搜索规则名或路径，如 telegram" className="h-10 max-w-[360px]" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select aria-label="客户端筛选" className="w-40" value={client} onChange={e => setClient(e.target.value)}><option value="">全部客户端</option><option value="mihomo">mihomo</option><option value="surge">Surge</option></Select>
        <div role="group" aria-label="仓库" className="flex flex-wrap gap-1.5">
          {[{ id: undefined, name: '全部仓库' }, ...(repos.data?.repos.filter(r => r.enabled) ?? [])].map((r) => (
            <button key={r.id ?? 'all'} type="button" aria-pressed={repo === r.id} onClick={() => setRepo(r.id)}
              className={cx('h-9 cursor-pointer rounded-full border px-3.5 text-[13px]', repo === r.id ? 'border-accent bg-[#f5f8ff] font-medium text-accent-ink' : 'border-[#d5d9e0] bg-panel text-ink-2 hover:bg-ground')}>{r.name}</button>
          ))}
        </div>
      </div>
      <ErrorBox error={repos.error ?? search.error} />

      <PageScroll>
        <div className="flex flex-wrap items-start gap-5">
          <section aria-label="搜索结果" className="min-w-0 flex-[1_1_360px] overflow-hidden rounded-[10px] border border-line bg-panel">
            <div className="border-b border-line-2 px-4 py-3 text-[12.5px] text-muted">{search.isFetching ? '搜索中…' : `${search.data?.total ?? 0} 个结果`}</div>
            {items.map((x) => {
              const on = sel?.repo === x.repo && sel.path === x.path;
              return (
                <button key={`${x.repo}:${x.path}`} type="button" aria-current={on || undefined} onClick={() => { setSel(x); setVariant(''); use.reset(); }}
                  className={cx('flex w-full cursor-pointer items-center gap-3 border-b border-line-2 px-4 py-3 text-left last:border-0', on ? 'bg-[#f5f8ff]' : 'hover:bg-ground')}>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="text-[13.5px] font-medium">{x.name}</span><span className="truncate font-mono text-[12px] text-muted">{x.path}</span></span>
                  <span className="flex flex-col items-end gap-0.5"><span className="font-mono text-[12.5px]">{x.clients?.map(clientLabel).join(' / ')}</span><span className="text-[11.5px] text-muted">{repoName(x.repo)}</span></span>
                </button>
              );
            })}
            {!items.length && !search.isFetching && <div className="px-4 py-4"><Empty title={debounced ? `没有找到「${debounced}」` : '暂无可用索引，请等待首次更新或联系管理员'} /></div>}
            {(search.data?.total ?? 0) > 50 && <div className="flex items-center justify-between gap-2 p-3">
              <Button size="sm" disabled={offset === 0 || search.isFetching} onClick={() => setOffset(Math.max(0, offset - 50))}>上一页</Button>
              <span className="text-[12px] text-muted">第 {Math.floor(offset / 50) + 1} 页</span>
              <Button size="sm" disabled={offset + 50 >= (search.data?.total ?? 0) || search.isFetching} onClick={() => setOffset(offset + 50)}>下一页</Button>
            </div>}
          </section>

          <section aria-label="详情" className="flex min-w-0 flex-[999_1_520px] flex-col gap-4 rounded-[10px] border border-line bg-panel px-4.5 py-4">
            {!sel ? <Empty title="还没有选择规则" /> : <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <h2 className="m-0 text-[17px] font-semibold">{sel.name}</h2>
                  <span className="font-mono text-[12px] text-muted">{repoName(sel.repo)} · {sel.path}</span>
                </div>
                {d?.rejected ? <RejectedRulesPopover sourceName={sel.name} status={{ id: sel.path, ok: true, rules: d.count, rejected: d.rejected, rejectedDetails: d.rejectedDetails }} /> : <Badge>{d?.count === undefined ? '条数待读取' : `${d.count} 条`}</Badge>}
              </div>
              <ErrorBox error={detail.error} />
              {d && <>
                <div className="flex flex-wrap gap-2 text-[12.5px]">
                  {d.license && <Badge>许可证 {d.license}</Badge>}
                  <a href={d.url} target="_blank" rel="noreferrer" className="text-accent">上游仓库</a>
                </div>
                <Card title="可用变体" bodyClass="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead><tr><th className={th}>客户端</th><th className={th}>文件</th><th className={th}>方式</th></tr></thead>
                    <tbody>{d.variants.map((v) => <tr key={v.id}><td className={cx(td, 'font-medium')}>{clientLabel(v.client)}</td><td className={cx(td, 'font-mono text-[12px]')}>{v.files.map(f => <a key={`${f.path}:${f.url}`} className="block text-accent" href={f.upstream} target="_blank" rel="noreferrer">{f.path}</a>)}{v.recommended && <span className="text-muted">推荐文本变体</span>}</td><td className={cx(td, 'text-ink-2')}>{v.how}</td></tr>)}</tbody>
                  </table>
                </Card>
                <Select aria-label="导入变体" value={variant} onChange={e => setVariant(e.target.value)}>
                  <option value="">自动选择推荐文本变体</option>
                  {d.variants.filter(v => v.files.every(f => f.format !== 'mrs')).map(v => <option key={v.id} value={v.id}>{clientLabel(v.client)} · {v.label}</option>)}
                </Select>
                <span className="text-[12px] text-muted">预览为推荐文本变体。导入后保存为远程来源，可在规则集内合并、改写并托管输出。</span>
                {d.previewError && <div className="text-[13px] text-err">{d.previewError}<Button size="sm" onClick={() => void detail.refetch()}>重试预览</Button></div>}
                <div className="flex flex-col gap-1.5"><span className="text-[12.5px] font-medium text-muted">内容预览</span>
                  <CodePreview text={d.preview.join('\n')} bodyClassName="max-h-64" /></div>
              </>}
              <ErrorBox error={use.error} />
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" disabled={use.isPending || !d || detail.isFetching || (!!d.previewError && d.variants.some(v => v.client === 'any'))} onClick={() => use.mutate()}>{ruleset ? '加入规则集' : '引用为规则集'}</Button>
                {!ruleset && <Link to="/rulesets" className={buttonClass()}>加入已有规则集…</Link>}
              </div>
            </>}
          </section>
        </div>
      </PageScroll>
    </>
  );
}
