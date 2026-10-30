import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { api, type UserAccessLogRow } from '../api.ts';
import type { PageResult } from '../hooks/usePagedList.ts';
import { Pagination } from './Pagination.tsx';
import { Badge, Button, Card, Empty, Select, cx, formatTime, td, th } from './ui.tsx';

const TYPES = { subscription: '订阅', nodes: '节点订阅', 'rule-collection': '规则集合', enhancement: '增强集合' } as const;
const SOURCES: Record<string, string> = { fresh: '新生成', cache: '缓存', 'last-good': '上次成功结果', managed: '托管资源', failed: '失败', unsupported: '不支持' };

export function AccessLogCard() {
  const [kind, setKind] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const query = useQuery({
    queryKey: ['user-access-log', { kind, page, pageSize }],
    queryFn: () => api<PageResult<UserAccessLogRow>>('GET', `/access-log?${new URLSearchParams({ page: String(page), pageSize: String(pageSize), ...(kind === 'all' ? {} : { kind }) })}`),
    refetchInterval: 30_000,
  });
  const data = query.data;
  return <Card title="访问日志" className="min-w-0" bodyClass="" actions={<div className="flex flex-wrap items-center gap-2">
    <Select aria-label="访问类型" placeholder="选择要查看的访问类型" className="w-32" value={kind} onChange={event => { setKind(event.target.value); setPage(1); }}>
      <option value="all">全部类型</option>
      {Object.entries(TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </Select>
    <Button size="sm" aria-label="刷新访问日志" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw size={14} />刷新</Button>
  </div>}>
    <p className="mt-0 mb-3 px-4 text-[12.5px] text-ink-muted">仅记录本人令牌的访问 · 保留 30 天</p>
    {query.error && <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 px-4 text-[13px] text-err">访问日志加载失败：{query.error.message}<Button size="sm" onClick={() => void query.refetch()}>重试</Button></div>}
    <div className="overflow-x-auto" aria-busy={query.isFetching}>
      <table className="w-full min-w-[760px] border-collapse">
        <thead><tr><th className={th}>时间</th><th className={th}>类型</th><th className={th}>资源</th><th className={th}>客户端</th><th className={th}>结果</th><th className={th}>耗时</th></tr></thead>
        <tbody>
          {data?.items.map(row => <tr key={row.id}>
            <td className={cx(td, 'whitespace-nowrap font-mono text-[12px]')}>{formatTime(row.at).slice(5)}</td>
            <td className={cx(td, 'whitespace-nowrap')}><Badge>{TYPES[row.kind]}</Badge></td>
            <td className={cx(td, 'max-w-[240px] break-words')}><span className="font-medium">{row.resourceName}</span><div className="mt-1 text-[12px] text-ink-muted">{row.method} · {SOURCES[row.source] ?? row.source}</div></td>
            <td className={cx(td, 'max-w-[240px]')}><span>{row.client}{row.platform ? ` · ${row.platform}` : ''}</span><div title={row.ua} className="mt-1 max-w-[240px] truncate font-mono text-[11px] text-ink-muted">{row.ua || '未提供 User-Agent'}</div></td>
            <td className={cx(td, 'whitespace-nowrap')}><Badge tone={row.status >= 400 ? 'err' : row.warnings ? 'warn' : 'ok'}>{row.status}</Badge>{row.warnings > 0 && <span className="ml-2 text-[12px] text-ink-muted">{row.warnings} 条告警</span>}</td>
            <td className={cx(td, 'whitespace-nowrap font-mono text-[12px]')}>{row.ms >= 1000 ? `${(row.ms / 1000).toFixed(2)} s` : `${row.ms} ms`}</td>
          </tr>)}
          {!data?.items.length && <tr><td colSpan={6} className={td}>{query.isPending ? <div role="status" className="py-5 text-center text-ink-muted">正在加载访问日志…</div> : !query.error && <Empty title={kind === 'all' ? '还没有访问记录' : '该类型暂无访问记录'} />}</td></tr>}
        </tbody>
      </table>
    </div>
    {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} totalPages={data.totalPages} busy={query.isFetching} onPage={setPage} onPageSize={value => { setPageSize(value); setPage(1); }} />}
  </Card>;
}
