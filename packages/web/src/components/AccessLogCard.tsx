import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { api, type UserAccessLogRow } from '../api.ts';
import type { PageResult } from '../hooks/usePagedList.ts';
import { Pagination } from './Pagination.tsx';
import { Badge, Button, Card, Empty, Select, formatTime } from './ui.tsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table.tsx';

const TYPES = { subscription: '订阅', nodes: '节点订阅', 'rule-collection': '规则集合', enhancement: '增强集合' } as const;
const SOURCES: Record<string, string> = { fresh: '新生成', cache: '缓存', 'last-good': '上次成功结果', managed: '托管资源', file: '原文预览', failed: '失败', unsupported: '不支持' };

export function AccessLogCard() {
  const [kind, setKind] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const query = useQuery({
    queryKey: ['user-access-log', { kind, page, pageSize }],
    queryFn: () => api<PageResult<UserAccessLogRow>>('GET', `/access-log?${new URLSearchParams({ page: String(page), pageSize: String(pageSize), ...(kind === 'all' ? {} : { kind }) })}`),
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[1] as { kind?: string } | undefined)?.kind === kind ? previous : undefined,
    refetchInterval: 30_000,
  });
  const data = query.data;
  return <Card title={<h2 className="m-0 text-base font-semibold">访问日志 <span className="ml-1 text-xs font-normal text-muted-foreground">本人令牌 · 保留 30 天</span></h2>} className="min-w-0" bodyClass="" actions={<div className="flex flex-wrap items-center gap-2">
    <Select aria-label="访问类型" placeholder="选择要查看的访问类型" className="w-40" value={kind} onChange={event => { setKind(event.target.value); setPage(1); }}>
      <option value="all">全部类型</option>
      {Object.entries(TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </Select>
    <Button variant="ghost" aria-label="刷新访问日志" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw size={14} />刷新</Button>
  </div>}>
    {query.error && <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 px-4 text-sm text-destructive">访问日志加载失败：{query.error.message}<Button size="sm" onClick={() => void query.refetch()}>重试</Button></div>}
    <div aria-busy={query.isFetching}>
      <Table className="min-w-[640px]">
        <TableHeader><TableRow><TableHead>时间</TableHead><TableHead>类型</TableHead><TableHead>资源</TableHead><TableHead>客户端</TableHead><TableHead>结果</TableHead></TableRow></TableHeader>
        <TableBody>
          {data?.items.map(row => <TableRow key={row.id}>
            <TableCell className="whitespace-nowrap font-mono text-xs">{formatTime(row.at).slice(5)}</TableCell>
            <TableCell className="whitespace-nowrap"><Badge>{TYPES[row.kind]}</Badge></TableCell>
            <TableCell className="max-w-[240px] break-words"><span className="font-medium">{row.resourceName}</span></TableCell>
            <TableCell className="max-w-[240px]" title={`${row.ua || '未提供 User-Agent'} · IP ${row.clientIp ?? '未记录'} · ${row.ms} ms · ${row.method} · ${SOURCES[row.source] ?? row.source}`}><span>{row.client}{row.platform ? ` · ${row.platform}` : ''}</span></TableCell>
            <TableCell className="whitespace-nowrap"><Badge tone={row.status >= 400 ? 'err' : row.warnings ? 'warn' : 'ok'}>{row.status}</Badge>{row.warnings > 0 && <span className="ml-2 text-xs text-muted-foreground">{row.warnings} 条告警</span>}</TableCell>
          </TableRow>)}
          {!data?.items.length && <TableRow className="hover:bg-transparent"><TableCell colSpan={5}>{query.isPending ? <div role="status" className="py-5 text-center text-muted-foreground">正在加载访问日志…</div> : !query.error && <Empty title={kind === 'all' ? '还没有访问记录' : '该类型暂无访问记录'} />}</TableCell></TableRow>}
        </TableBody>
      </Table>
    </div>
    {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} totalPages={data.totalPages} busy={query.isFetching} onPage={setPage} onPageSize={value => { setPageSize(value); setPage(1); }} />}
  </Card>;
}
