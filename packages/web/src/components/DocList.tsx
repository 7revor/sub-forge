// 文档列表页（设计稿「列表页 · 订阅源与新建」）：标题 + 说明 + 新建按钮，表格卡片顶部带搜索与计数；
// 空列表统一用虚线卡片：一句话说明 + 新建按钮。

import { Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useList, type DocMap, type Kind } from '../hooks.ts';
import { Button, buttonClass, Card, cx, ErrorBox, Input, PageHeader, td, th } from './ui.tsx';
import { DocActionLink, DocTableRow, actionHeader, docNameLinkClass } from './DocTableRow.tsx';

export type Column<K extends Kind> = { header: string; cell: (d: DocMap[K]) => ReactNode; className?: string };

export function DocList<K extends Kind>({ kind, title, columns, intro, canCreate = true, noun, onCreate, empty }: {
  kind: K; title: string; columns: Column<K>[]; intro?: ReactNode; canCreate?: boolean;
  /** 「新建 X」「搜索 X」里的对象名，默认用标题 */
  noun?: string;
  /** 提供时「新建」打开对话框，否则跳转到 /kind/new */
  onCreate?: () => void;
  /** 空列表卡片里的说明 */
  empty?: ReactNode;
}) {
  const list = useList(kind);
  const [q, setQ] = useState('');
  const name = noun ?? title;
  const createButton = (size: 'sm' | 'md', variant: 'primary' | 'default') => onCreate
    ? <Button variant={variant} size={size} onClick={onCreate}>{size === 'md' && <Plus size={16} />}新建{name}</Button>
    : <Link to={`/${kind}/new`} className={buttonClass(variant, size)}>{size === 'md' && <Plus size={16} />}新建{name}</Link>;
  const rows = (list.data ?? []).filter((d) => !q.trim() || d.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <PageHeader title={title} subtitle={intro} actions={canCreate && createButton('md', 'primary')} />
      <ErrorBox error={list.error} />
      {list.isLoading ? <div className="text-muted">加载中…</div> : !list.data?.length ? (
        <section className="flex flex-col items-center gap-2 rounded-[10px] border border-dashed border-[#d5d9e0] bg-panel px-7 py-7 text-center">
          <span className="text-[14px] font-semibold">还没有{name}</span>
          {empty && <span className="max-w-[420px] text-[12.5px] leading-relaxed text-muted">{empty}</span>}
          {canCreate && createButton('sm', 'default')}
        </section>
      ) : (
        <Card bodyClass="overflow-x-auto" title={<Input aria-label={`搜索${name}`} placeholder="搜索名称" className="max-w-[280px]" value={q} onChange={(e) => setQ(e.target.value)} />}
          actions={<span className="text-[12.5px] text-muted">{q.trim() ? `${rows.length} / ` : ''}{list.data.length} 个{name}</span>}>
          <table className="w-full border-collapse">
            <thead><tr>{columns.map((c) => <th key={c.header} className={cx(th, 'px-3.5')}>{c.header}</th>)}<th className={cx(th, 'w-px')}>{actionHeader}</th></tr></thead>
            <tbody>
              {rows.map((d) => (
                <DocTableRow key={d.id} to={`/${kind}/${d.id}`}>
                  {columns.map((c, i) => (
                    <td key={c.header} className={cx(td, 'px-3.5 py-3 whitespace-nowrap', c.className)}>
                      {i === 0 ? <Link to={`/${kind}/${d.id}`} className={docNameLinkClass}>{c.cell(d)}</Link> : c.cell(d)}
                    </td>
                  ))}
                  <td className={cx(td, 'text-right')}><DocActionLink to={`/${kind}/${d.id}`} name={d.name} /></td>
                </DocTableRow>
              ))}
              {!rows.length && <tr><td className={cx(td, 'text-muted')} colSpan={columns.length + 1}>没有名称包含「{q.trim()}」的{name}</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

/** 删除确认对话框里的原因：被引用时附上引用方 */
export function deleteErrorText(err: unknown): string | undefined {
  if (!err) return undefined;
  const e = err as { message?: string; details?: { referrers?: string[] } };
  return e.details?.referrers ? `${e.message}：${e.details.referrers.join('、')}` : e.message;
}
