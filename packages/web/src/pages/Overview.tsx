import { formatRelativeTime } from '../utils/format.ts';
import { accessLogOptions, snapshotOptions } from '../hooks/documentQueries.ts';
import { sourceFetchSummary } from '../domain/sourceFetch.ts';
import { SourceFetchStatus } from '../components/SourceFetchStatus.tsx';
import { NodeSetCount } from '../components/NodeSetCount.tsx';
// 总览（设计稿「总览」）：四个统计、我的配置订阅（最近访问与状态）、待处理事项、订阅源拉取。
// 访问统计来自各配置订阅的访问日志，孤儿覆盖项按当前模板计算。

import { useQueries } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Link } from 'react-router';
import { DocActionLink, DocTableRow, actionHeader, docNameLinkClass } from '../components/DocTableRow.tsx';
import { Badge, buttonClass, Card, Empty, PageHeader, PageScroll, formatBytes, formatTime, td, th, cx } from '../components/ui.tsx';
import { useList, useTemplates } from '../hooks.ts';
import { findOverlayOrphans } from './profile/orphans.ts';

const DAY = 86_400_000;

type Todo = { tone: 'err' | 'warn' | 'info'; title: string; body: string; action: string; to: string };
const DOT = { err: 'bg-err', warn: 'bg-[#c76a12]', info: 'bg-accent' } as const;

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
    const t = p.template ? tpl(p.template.id) : undefined;
    const o = t ? findOverlayOrphans(p.overlay, t) : undefined;
    return { p, last: log[0], recent: log.filter((r) => Date.now() - r.at < DAY), orphans: o ? Object.values(o).reduce((n, ids) => n + ids.length, 0) : 0 };
  });
  const recent = rows.flatMap((r) => r.recent);
  const hitRate = recent.length ? Math.round((recent.filter((r) => r.source === 'cache').length / recent.length) * 100) : undefined;
  const orphanTotal = rows.reduce((n, r) => n + r.orphans, 0);

  const todos: Todo[] = [
    ...failing.map(({ source, lastFail, lastOk }) => ({
      tone: 'err' as const, title: `订阅源「${source.name}」拉取失败`,
      body: `${lastFail?.error ?? '未知错误'}。${lastOk ? `订阅请求正在使用 ${formatTime(lastOk.fetchedAt).slice(5)} 的快照，不会等待上游。` : '还没有可用快照，相关配置订阅暂时无法渲染。'}`,
      action: '查看订阅源', to: `/sources/${source.id}`,
    })),
    ...rows.filter((r) => r.orphans > 0).map((r) => ({
      tone: 'warn' as const, title: `「${r.p.name}」有 ${r.orphans} 个孤儿覆盖项`,
      body: '模板删除了对应的组或规则，这些填充与改写不再输出。', action: '去清理', to: `/profiles/${r.p.id}/rules`,
    })),
    ...rows.filter((r) => r.last && r.last.warnings > 0).map((r) => ({
      tone: 'warn' as const, title: `「${r.p.name}」最近一次渲染有 ${r.last!.warnings} 条告警`,
      body: `${r.last!.client} 于 ${formatRelativeTime(r.last!.at)} 拉取。告警不影响下发，但可能有组为空或引用失效。`, action: '查看预览与渲染报告', to: `/profiles/${r.p.id}/preview`,
    })),
    ...rows.filter((r) => r.p.template && !r.p.nodeSets.length).map((r) => ({
      tone: 'info' as const, title: `「${r.p.name}」还没有节点集`, body: '模板组都会按「为空时」的设定输出。', action: '去加入节点集', to: `/profiles/${r.p.id}/nodesets`,
    })),
  ];

  const stats: [string, string | number, string][] = [
    ['配置订阅', profiles.data?.length ?? '—', `${rows.filter((r) => r.recent.length).length} 个近 24 小时有访问`],
    ['订阅源', sources.data?.length ?? '—', failing.length ? `${failing.length} 个拉取失败，正在使用快照` : '拉取正常'],
    ['孤儿覆盖项', orphanTotal, orphanTotal ? '模板删除了元素，待清理' : '没有失效的覆盖项'],
    ['近 24 小时订阅请求', recent.length, hitRate === undefined ? '暂无请求' : `缓存命中 ${hitRate}%`],
  ];

  return (
    <>
      <PageHeader title="总览" subtitle="配置订阅状态、上游拉取与待处理事项"
        actions={<Link to="/profiles/new" className={buttonClass('primary')}><Plus size={16} />新建配置订阅</Link>} />

      <PageScroll>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
          {stats.map(([label, value, sub]) => (
            <div key={label} className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-panel px-4.5 py-4">
              <span className="text-[12.5px] text-muted">{label}</span>
              <span className="text-[28px] font-semibold tracking-tight">{value}</span>
              <span className="text-[12.5px] text-muted">{sub}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-start gap-5">
          <Card title="我的配置订阅" actions={<span className="text-[12.5px] text-muted">{profiles.data?.length ?? 0} 个</span>} className="min-w-0 flex-[999_1_640px]" bodyClass="overflow-x-auto">
            {profiles.data?.length === 0 ? <div className="px-4 pb-4"><Empty title="还没有配置订阅" action={<Link to="/profiles/new" className="text-accent">新建一个</Link>} /></div> : (
              <table className="w-full border-collapse">
                <thead><tr><th className={th}>名称</th><th className={th}>模板</th><th className={th}>节点集</th><th className={th}>最近访问</th><th className={th}>状态</th><th className={cx(th, 'w-px')}>{actionHeader}</th></tr></thead>
                <tbody>
                  {rows.map(({ p, last }) => (
                    <DocTableRow key={p.id} to={`/profiles/${p.id}`}>
                      <td className={cx(td, 'whitespace-nowrap')}><Link to={`/profiles/${p.id}`} className={docNameLinkClass}>{p.name}</Link></td>
                      <td className={cx(td, 'whitespace-nowrap')}>{p.template ? <>{tpl(p.template.id)?.name ?? p.template.id} <span className="text-[12.5px] text-muted">{p.template.follow === 'latest' ? '跟随最新' : `锁定 v${p.template.follow.pinned}`}</span></> : '—'}</td>
                      <td className={cx(td, 'font-mono')}>{p.nodeSets.length}</td>
                      <td className={td}>{last ? <div className="flex flex-col gap-0.5"><span className="whitespace-nowrap">{formatRelativeTime(last.at)}</span><span className="text-[12px] text-muted">{last.client}</span></div> : <span className="text-muted">从未访问</span>}</td>
                      <td className={td}>{!last ? <Badge>未访问</Badge> : last.status !== 200 ? <Badge tone="err">渲染失败</Badge> : last.warnings ? <Badge tone="warn">{last.warnings} 条告警</Badge> : <Badge tone="ok">正常</Badge>}</td>
                      <td className={cx(td, 'text-right')}><DocActionLink to={`/profiles/${p.id}`} name={p.name} /></td>
                    </DocTableRow>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="待处理" className="min-w-0 flex-[1_1_340px]" bodyClass="px-4 pb-2">
            {!todos.length ? <Empty title="没有待处理事项" /> : (
              <ul className="m-0 flex list-none flex-col p-0">
                {todos.map((t, i) => (
                  <li key={i} className="flex gap-3 border-t border-line-2 py-3">
                    <span aria-hidden="true" className={cx('mt-[7px] h-2 w-2 shrink-0 rounded-full', DOT[t.tone])} />
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="text-[13.5px] font-medium">{t.title}</span>
                      <span className="text-[12.5px] leading-normal text-muted">{t.body}</span>
                      <Link to={t.to} className="text-[12.5px] font-medium text-accent">{t.action}</Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card title="订阅源拉取" actions={<Link to="/sources" className="text-[13px] text-accent">全部订阅源</Link>} bodyClass="overflow-x-auto">
          {!sources.data?.length ? <div className="px-4 pb-4"><Empty title="还没有订阅源" /></div> : (
            <table className="w-full border-collapse">
              <thead><tr><th className={th}>订阅源</th><th className={th}>节点</th><th className={th}>上次成功</th><th className={th}>流量</th><th className={th}>到期</th><th className={th}>状态</th><th className={cx(th, 'w-px')}>{actionHeader}</th></tr></thead>
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
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-line-2"><div className="h-1.5 bg-accent" style={{ width: `${pct}%` }} /></div>
                          <span className="text-[12.5px] whitespace-nowrap text-muted">{formatBytes(used)} / {formatBytes(u.total)}</span>
                        </div>
                      ) : <span className="text-[12.5px] text-muted">—</span>}</td>
                      <td className={cx(td, 'whitespace-nowrap text-muted')}>{u?.expire ? formatTime(u.expire * 1000).slice(0, 10) : '—'}</td>
                      <td className={td}><SourceFetchStatus state={st ?? { failing: false, lastOk: undefined }} /></td>
                      <td className={cx(td, 'text-right')}><DocActionLink to={`/sources/${source.id}`} name={source.name} /></td>
                    </DocTableRow>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </PageScroll>
    </>
  );
}
