// 总览：配置订阅与订阅源的状态、待处理事项（拉取失败）。

import { useQueries } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Link } from 'react-router';
import { api, type SnapshotMeta } from '../api.ts';
import { Badge, Card, Empty, PageHeader, formatBytes, formatTime, td, th, cx } from '../components/ui.tsx';
import { useList, useTemplates } from '../hooks.ts';

export function Overview() {
  const profiles = useList('profiles');
  const sources = useList('sources');
  const templates = useTemplates();
  const remote = (sources.data ?? []).filter((s) => s.kind === 'remote');
  const snaps = useQueries({
    queries: remote.map((s) => ({ queryKey: ['snapshots', s.id], queryFn: () => api<{ items: SnapshotMeta[] }>('GET', `/sources/${s.id}/snapshots`).then((r) => r.items) })),
  });
  const status = remote.map((s, i) => {
    const items = snaps[i]?.data ?? [];
    const lastOk = items.find((x) => x.ok);
    const lastFail = items.find((x) => !x.ok);
    const failing = !!lastFail && (!lastOk || lastFail.fetchedAt > lastOk.fetchedAt);
    return { source: s, lastOk, lastFail, failing };
  });
  const failing = status.filter((s) => s.failing);
  const tplName = (id?: string) => templates.data?.find((t) => t.id === id)?.name ?? id ?? '—';

  return (
    <>
      <PageHeader title="总览" subtitle="配置订阅状态、上游拉取与待处理事项" actions={<Link to="/profiles/new" className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-[14px] font-medium text-white no-underline hover:bg-accent-strong"><Plus size={16} />新建配置订阅</Link>} />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
        {[
          ['配置订阅', profiles.data?.length ?? '—', ''],
          ['订阅源', sources.data?.length ?? '—', failing.length ? `${failing.length} 个拉取失败` : '拉取正常'],
          ['模板', templates.data?.length ?? '—', '管理员维护'],
        ].map(([label, value, sub]) => (
          <div key={label as string} className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-panel px-4.5 py-4">
            <span className="text-[12.5px] text-muted">{label}</span>
            <span className="text-[28px] font-semibold tracking-tight">{value}</span>
            <span className="text-[12.5px] text-muted">{sub}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <Card title="我的配置订阅" className="min-w-0 flex-[999_1_640px]" bodyClass="overflow-x-auto">
          {profiles.data?.length === 0 ? <div className="px-4 pb-4"><Empty>还没有配置订阅。<Link to="/profiles/new" className="text-accent">新建一个</Link></Empty></div> : (
            <table className="w-full border-collapse">
              <thead><tr><th className={th}>名称</th><th className={th}>模板</th><th className={th}>节点集</th><th className={th}>代理链</th></tr></thead>
              <tbody>
                {(profiles.data ?? []).map((p) => (
                  <tr key={p.id}>
                    <td className={td}><Link to={`/profiles/${p.id}`} className="font-medium text-ink no-underline hover:text-accent">{p.name}</Link></td>
                    <td className={td}>{p.template ? <>{tplName(p.template.id)} <span className="text-[12px] text-muted">{p.template.follow === 'latest' ? '跟随最新' : `锁定 v${p.template.follow.pinned}`}</span></> : '—'}</td>
                    <td className={cx(td, 'font-mono')}>{p.nodeSets.length}</td>
                    <td className={cx(td, 'font-mono')}>{p.chains.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="待处理" className="min-w-0 flex-[1_1_340px]">
          {!failing.length ? <p className="m-0 text-[13px] text-muted">没有待处理事项。</p> : (
            <ul className="m-0 flex list-none flex-col p-0">
              {failing.map(({ source, lastFail, lastOk }) => (
                <li key={source.id} className="flex gap-3 border-t border-line-2 py-3 first:border-0 first:pt-0">
                  <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-err" />
                  <div className="flex flex-col gap-1">
                    <span className="font-medium">订阅源「{source.name}」拉取失败</span>
                    <span className="text-[12.5px] text-muted">{lastFail?.error}。{lastOk ? `订阅正在使用 ${formatTime(lastOk.fetchedAt)} 的快照。` : '还没有可用快照，相关配置订阅暂时无法渲染。'}</span>
                    <Link to={`/sources/${source.id}`} className="text-[12.5px] font-medium text-accent">查看订阅源</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="订阅源拉取" actions={<Link to="/sources" className="text-[13px] text-accent">全部订阅源</Link>} bodyClass="overflow-x-auto">
        {remote.length === 0 ? <div className="px-4 pb-4"><Empty>没有远程订阅源。</Empty></div> : (
          <table className="w-full border-collapse">
            <thead><tr><th className={th}>订阅源</th><th className={th}>上次成功</th><th className={th}>流量</th><th className={th}>到期</th><th className={th}>状态</th></tr></thead>
            <tbody>
              {status.map(({ source, lastOk, failing: f }) => {
                const u = lastOk?.userinfo;
                const used = u ? (u.upload ?? 0) + (u.download ?? 0) : undefined;
                return (
                  <tr key={source.id}>
                    <td className={td}><Link to={`/sources/${source.id}`} className="font-medium text-ink no-underline hover:text-accent">{source.name}</Link></td>
                    <td className={td}>{lastOk ? formatTime(lastOk.fetchedAt) : '—'}</td>
                    <td className={td}>{u?.total ? `${formatBytes(used)} / ${formatBytes(u.total)}` : '无流量信息'}</td>
                    <td className={cx(td, 'text-muted')}>{u?.expire ? formatTime(u.expire * 1000).slice(0, 10) : '—'}</td>
                    <td className={td}>{f ? <Badge tone="err">{lastOk ? '拉取失败 · 使用快照' : '拉取失败'}</Badge> : lastOk ? <Badge tone="ok">正常</Badge> : <Badge>未拉取</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
