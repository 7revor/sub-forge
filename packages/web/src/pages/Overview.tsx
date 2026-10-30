import { AccessLogCard } from '../components/AccessLogCard.tsx';
import { boundTemplateId, modeLabel } from './profile/routing.ts';
import { formatRelativeTime } from '../utils/format.ts';
import { accessLogOptions, snapshotOptions } from '../hooks/documentQueries.ts';
import { sourceFetchSummary } from '../domain/sourceFetch.ts';
import { SourceFetchStatus } from '../components/SourceFetchStatus.tsx';
import { NodeSetCount } from '../components/NodeSetCount.tsx';
// 总览：配置订阅与节点订阅各自承载状态和处理入口，访问统计来自配置订阅日志。

import { useQueries } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Link } from 'react-router';
import { DocActionLink, DocTableRow, actionHeader, docNameLinkClass } from '../components/DocTableRow.tsx';
import { Badge, buttonClass, Card, Empty, PageHeader, PageScroll, formatBytes, formatTime, td, th, cx } from '../components/ui.tsx';
import { useList, useTemplates } from '../hooks.ts';

const DAY = 86_400_000;

type Notice = { id: string; tone: 'warn' | 'info'; title: string; body: string; action: string; to: string };
const DOT = { warn: 'bg-warn', info: 'bg-brand' } as const;

/** 提醒放在对应列表内；无异常时不占用展示空间。 */
function OverviewNotices({ items }: { items: Notice[] }) {
  if (!items.length) return null;
  return (
    <ul className="mx-4 mb-4 list-none divide-y divide-line-2 rounded-lg border border-line-2 bg-ground px-3.5">
      {items.map((item) => (
        <li key={item.id} className="flex items-start gap-2.5 py-3">
          <span aria-hidden="true" className={cx('mt-[7px] h-2 w-2 shrink-0 rounded-full', DOT[item.tone])} />
          <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-5 gap-y-2">
            <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1 break-words">
              <span className="text-[13px] font-medium">{item.title}</span>
              <span className="text-[12.5px] leading-normal text-ink-muted">{item.body}</span>
            </div>
            <Link to={item.to} className="shrink-0 text-[12.5px] font-medium text-brand">{item.action}</Link>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Overview() {
  const profiles = useList('profiles');
  const sources = useList('sources');
  const templates = useTemplates();
  const remote = sources.data ?? [];
  const snaps = useQueries({
    queries: remote.map((source) => snapshotOptions(source.id)),
  });
  const logs = useQueries({
    queries: (profiles.data ?? []).map((profile) => accessLogOptions(profile.id)),
  });
  const status = remote.map((source, index) => ({ source, ...sourceFetchSummary(snaps[index]?.data ?? []) }));
  const failing = status.filter((s) => s.failing);
  const tpl = (id?: string) => templates.data?.find((t) => t.id === id);

  const rows = (profiles.data ?? []).map((p, i) => {
    const log = logs[i]?.data ?? [];
    return { p, last: log[0], recent: log.filter((r) => Date.now() - r.at < DAY) };
  });
  const recent = rows.flatMap((r) => r.recent);
  const hitRate = recent.length ? Math.round((recent.filter((r) => r.source === 'cache').length / recent.length) * 100) : undefined;

  const profileNotices: Notice[] = [
    ...rows.filter((r) => r.last && r.last.warnings > 0).map((r) => ({
      id: `warnings:${r.p.id}`, tone: 'warn' as const, title: `「${r.p.name}」最近一次渲染有 ${r.last!.warnings} 条告警`,
      body: `${r.last!.client} 于 ${formatRelativeTime(r.last!.at)} 拉取。告警不影响下发，但可能有组为空或引用失效。`, action: '查看预览与渲染报告', to: `/profiles/${r.p.id}/preview`,
    })),
    ...rows.filter((r) => boundTemplateId(r.p) && !r.p.nodeSets.length).map((r) => ({
      id: `nodesets:${r.p.id}`, tone: 'info' as const, title: `「${r.p.name}」还没有节点集`, body: '没有成员的策略组会自动拒绝连接。', action: '去加入节点集', to: `/profiles/${r.p.id}/nodesets`,
    })),
  ];

  const stats: [string, string | number, string][] = [
    ['配置订阅', profiles.data?.length ?? '—', `${rows.filter((r) => r.recent.length).length} 个近 24 小时有访问`],
    ['节点订阅', sources.data?.length ?? '—', failing.length ? `${failing.length} 个拉取失败` : remote.length ? '拉取正常' : '暂无节点订阅'],
    ['近 24 小时订阅请求', recent.length, hitRate === undefined ? '暂无请求' : `缓存命中 ${hitRate}%`],
  ];

  return (
    <>
      <PageHeader title="总览"
        actions={<Link to="/profiles/new" className={buttonClass('primary')}><Plus size={16} />新建配置订阅</Link>} />

      <PageScroll>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {stats.map(([label, value, sub]) => (
            <div key={label} className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-panel px-4.5 py-4">
              <span className="text-[12.5px] text-ink-muted">{label}</span>
              <span className="text-[28px] font-semibold tracking-tight">{value}</span>
              <span className="text-[12.5px] text-ink-muted">{sub}</span>
            </div>
          ))}
        </div>

        <Card title="配置订阅" actions={<span className="text-[12.5px] text-ink-muted">{profiles.data?.length ?? 0} 个</span>} className="min-w-0" bodyClass="">
          <OverviewNotices items={profileNotices} />
          <div className="overflow-x-auto">
            {profiles.data?.length === 0 ? <div className="px-4 pb-4"><Empty title="还没有配置订阅" action={<Link to="/profiles/new" className="text-brand">新建一个</Link>} /></div> : (
              <table className="w-full border-collapse">
                <thead><tr><th className={th}>名称</th><th className={th}>模板</th><th className={th}>节点集</th><th className={th}>最近访问</th><th className={th}>状态</th><th className={cx(th, 'w-px')}>{actionHeader}</th></tr></thead>
                <tbody>
                  {rows.map(({ p, last }) => (
                    <DocTableRow key={p.id} to={`/profiles/${p.id}`}>
                      <td className={cx(td, 'whitespace-nowrap')}><Link to={`/profiles/${p.id}`} className={docNameLinkClass}>{p.name}</Link></td>
                      <td className={cx(td, 'whitespace-nowrap')}>{modeLabel(p, tpl(boundTemplateId(p))?.name)}</td>
                      <td className={cx(td, 'font-mono')}>{p.nodeSets.length}</td>
                      <td className={td}>{last ? <div className="flex flex-col gap-0.5"><span className="whitespace-nowrap">{formatRelativeTime(last.at)}</span><span className="text-[12px] text-ink-muted">{last.client}</span></div> : <span className="text-ink-muted">从未访问</span>}</td>
                      <td className={td}>{!last ? <Badge>未访问</Badge> : last.status !== 200 ? <Badge tone="err">渲染失败</Badge> : last.warnings ? <Badge tone="warn">{last.warnings} 条告警</Badge> : <Badge tone="ok">正常</Badge>}</td>
                      <td className={cx(td, 'text-right')}><DocActionLink to={`/profiles/${p.id}`} name={p.name} /></td>
                    </DocTableRow>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>

        <Card title="节点订阅" actions={<Link to="/sources" className="text-[13px] text-brand">全部节点订阅</Link>} className="min-w-0" bodyClass="">
          <div className="overflow-x-auto">
            {!sources.data?.length ? <div className="px-4 pb-4"><Empty title="还没有节点订阅" /></div> : (
              <table className="w-full border-collapse">
                <thead><tr><th className={th}>名称</th><th className={th}>节点</th><th className={th}>上次成功</th><th className={th}>流量</th><th className={th}>到期</th><th className={th}>状态</th><th className={cx(th, 'w-px')}>{actionHeader}</th></tr></thead>
                <tbody>
                  {(sources.data ?? []).map((source) => {
                    const st = status.find((x) => x.source.id === source.id);
                    const u = st?.lastOk?.userinfo;
                    const used = u ? (u.upload ?? 0) + (u.download ?? 0) : undefined;
                    const pct = u?.total && used !== undefined ? Math.min(100, Math.round((used / u.total) * 100)) : 0;
                    return (
                      <DocTableRow key={source.id} to={`/sources/${source.id}`}>
                        <td className={cx(td, 'whitespace-nowrap')}><Link to={`/sources/${source.id}`} className={docNameLinkClass}>{source.name}</Link></td>
                        <td className={cx(td, 'font-mono')}><NodeSetCount nodeSet={{ type: 'source', id: source.id }} /></td>
                        <td className={cx(td, 'whitespace-nowrap')}>{st?.lastOk ? formatTime(st.lastOk.fetchedAt).slice(5) : '—'}</td>
                        <td className={td}>{u?.total ? (
                          <div className="flex items-center gap-2.5">
                            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-line-2"><div className="h-1.5 bg-brand" style={{ width: `${pct}%` }} /></div>
                            <span className="text-[12.5px] whitespace-nowrap text-ink-muted">{formatBytes(used)} / {formatBytes(u.total)}</span>
                          </div>
                        ) : <span className="text-[12.5px] text-ink-muted">—</span>}</td>
                        <td className={cx(td, 'whitespace-nowrap text-ink-muted')}>{u?.expire ? formatTime(u.expire * 1000).slice(0, 10) : '—'}</td>
                        <td className={td}><SourceFetchStatus state={st ?? { failing: false, lastOk: undefined }} /></td>
                        <td className={cx(td, 'text-right')}><DocActionLink to={`/sources/${source.id}`} name={source.name} /></td>
                      </DocTableRow>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </Card>
        <AccessLogCard />
      </PageScroll>
    </>
  );
}
