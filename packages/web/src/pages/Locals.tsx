import { YamlTextarea } from '../components/YamlTextarea.tsx';
import { useLeaveGuard } from '../hooks/useLeaveGuard.ts';
import { LeaveDialog } from '../components/LeaveDialog.tsx';
import { NamedCreateDialog } from '../components/NamedCreateDialog.tsx';
// 本地节点（LOC-01）：与订阅源一致的三层页面——
// /locals 分组列表 → /locals/:id 分组详情（节点表、分组 YAML）→ /locals/:id/nodes/:index 节点编辑子页（YAML）。
// 本地节点只录入节点信息，不设置前置：代理链统一在配置订阅的「代理链」中配置（REF-03）。
// 每个分组是一个节点集文档；节点子页直接保存整个分组。离开有未保存修改的页面前先确认。

import type { LocalProxy, LocalProxyGroup } from '@sub-forge/core';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { NoteCell, NoteField } from '../components/DocNote.tsx';
import { DocList } from '../components/DocList.tsx';
import { DocActionLink, DocTableRow, actionHeader, docNameLinkClass } from '../components/DocTableRow.tsx';
import { LocalNodeYamlEditor } from '../components/LocalNodeYamlEditor.tsx';
import { inspectLocalNodeYaml } from '../convert/localNodeYaml.ts';
import { useDebouncedValue } from '../hooks/useDebouncedValue.ts';
import { groupFromYaml, groupToYaml, proxyToYaml } from '../convert/proxyYaml.ts';
import { DeleteAction, DeleteDialog, ActionButtons } from '../components/DetailActions.tsx';
import { Badge, Button, buttonClass, Card, Empty, ErrorAlert, FieldError, Field, Input, Modal, PageHeader, cx, td, th } from '../components/ui.tsx';
import { useDocEditor } from '../components/useDocEditor.ts';
import { useDoc, useSaveDoc } from '../hooks.ts';

const EMPTY: LocalProxyGroup = { id: '', name: '', proxies: [] };
const crumbLink = 'text-muted no-underline';

function NewGroupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const save = useSaveDoc('locals');
  const [note, setNote] = useState('');
  useEffect(() => { if (open) setNote(''); }, [open]);
  return <NamedCreateDialog open={open} onClose={onClose} title="新建分组" label="分组名称" placeholder="例如：自建、家宽"
    pending={save.isPending} error={save.error} onReset={save.reset}
    onCreate={(name) => save.mutateAsync({ name, note, proxies: [] }, { onSuccess: (item) => { onClose(); navigate(`/locals/${item.id}`); } })}>
    <NoteField value={note} onChange={setNote} />
  </NamedCreateDialog>;
}

const typesText = (g: LocalProxyGroup) => [...new Set(g.proxies.map((p) => p.type))].join(' / ') || '—';

const GROUP_DELETE_BODY = '分组里的节点会一起删除；引用它的配置订阅需要先移除。';

/** /locals：分组列表，与订阅源列表同一形态 */
export function LocalList() {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <DocList kind="locals" title="本地节点" noun="分组" onCreate={() => setCreating(true)} deleteBody={GROUP_DELETE_BODY}
        columns={[
          { header: '名称', cell: (g) => g.name },
          { header: '备注', cell: (g) => <NoteCell note={g.note} /> },
          { header: '节点', cell: (g) => <span className="font-mono text-[13px]">{g.proxies.length}</span> },
          { header: '协议', cell: (g) => <span className="font-mono text-[12.5px] text-ink-2">{typesText(g)}</span> },
        ]} />
      <NewGroupModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

/** /locals/:id：分组详情，节点表的「编辑」「新增节点」进入节点子页 */
export function LocalEdit() {
  const e = useDocEditor('locals', EMPTY);
  const [groupText, setGroupText] = useState<string>();
  const [deletingNode, setDeletingNode] = useState<number>();
  const { blocker, leave } = useLeaveGuard(e.dirty && !e.isNew);
  if (e.isNew) return <Navigate to="/locals" replace />;
  if (!e.draft) return e.doc.error ? <ErrorAlert error={e.doc.error} /> : <div className="text-muted">加载中…</div>;
  const d = e.draft;
  const validName = !!d.name.trim();
  const setProxies = (proxies: LocalProxy[]) => e.setDraft({ ...d, proxies });
  const groupResult = groupText === undefined ? undefined : groupFromYaml(groupText);
  const nodePath = (i: number | 'new') => `/locals/${d.id}/nodes/${i}`;

  return (
    <>
      <PageHeader crumbs={<><Link to="/locals" className={crumbLink}>本地节点</Link> / {e.doc.data?.name}</>}
        title={d.name || '未命名'}
        actions={<>
          <ActionButtons items={[{ label: '分组 YAML', onSelect: () => setGroupText(groupToYaml(d.proxies)) }]} />
          <Button variant="primary" onClick={() => e.submit((draft) => ({ ...draft, name: draft.name.trim() }))} disabled={e.save.isPending || !e.dirty || !validName}>{e.save.isPending ? '保存中…' : e.dirty ? '保存分组' : '已保存'}</Button>
          <DeleteAction what="分组" name={d.name} body={GROUP_DELETE_BODY} error={e.del.error} pending={e.del.isPending} onReset={e.del.reset}
            onDelete={() => e.del.mutate(d.id, { onSuccess: () => leave('/locals') })} />
        </>}>
        <Badge>{d.proxies.length} 个节点</Badge>
        {e.dirty && <Badge tone="warn">有未保存的修改</Badge>}
      </PageHeader>
      <ErrorAlert error={e.save.error} />
      <Card title="基本信息" bodyClass="flex flex-col gap-4 px-4 pb-4">
        <Field label="名称">{(id) => <Input id={id} value={d.name} placeholder="例如：自建、家宽" aria-invalid={!validName} onChange={(event) => e.setDraft({ ...d, name: event.target.value })} />}</Field>
        {!validName && <span className="text-[12px] text-err">请填写分组名称</span>}
        <NoteField value={d.note} onChange={(note) => e.setDraft({ ...d, note })} />
      </Card>

      <Card scroll bodyClass="overflow-x-auto"
        title={<h2 className="m-0 text-[15px] font-semibold">节点</h2>}
        actions={<Link to={nodePath('new')} className={buttonClass('default', 'sm')}><Plus size={14} />新增节点</Link>}>
        {!d.proxies.length ? <div className="px-4 pb-4"><Empty title="这个分组还没有节点" /></div> : (
          <table className="w-full min-w-[620px] border-collapse">
            <thead><tr><th className={cx(th, 'px-3.5')}>名称</th><th className={cx(th, 'px-3.5')}>协议</th><th className={cx(th, 'px-3.5')}>服务器</th><th className={cx(th, 'w-px')}>{actionHeader}</th></tr></thead>
            <tbody>
              {d.proxies.map((p, i) => (
                <DocTableRow key={i} to={nodePath(i)}>
                  <td className={cx(td, 'px-3.5 py-3 whitespace-nowrap')}><Link to={nodePath(i)} className={docNameLinkClass}>{p.name}</Link></td>
                  <td className={cx(td, 'px-3.5 py-3')}><span className="rounded bg-[#ebedf1] px-1.5 py-0.5 font-mono text-[12px]">{p.type.toUpperCase()}</span></td>
                  <td className={cx(td, 'px-3.5 py-3 font-mono text-[12.5px] text-ink-2')}>{p.server}:{p.port}</td>
                  <td className={cx(td, 'text-right whitespace-nowrap')}>
                    <Button size="sm" variant="danger" aria-label={`删除 ${p.name}`} className="mr-2" onClick={() => { e.save.reset(); setDeletingNode(i); }}>删除</Button>
                    <DocActionLink to={nodePath(i)} name={p.name} />
                  </td>
                </DocTableRow>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal title="分组 YAML" open={groupText !== undefined} onClose={() => setGroupText(undefined)} wide
        footer={<><Button onClick={() => setGroupText(undefined)}>取消</Button><Button variant="primary" disabled={!groupResult?.ok} onClick={() => {
          if (groupResult?.ok) { setProxies(groupResult.value); setGroupText(undefined); }
        }}>应用到分组</Button></>}>
        <Field label="整个分组的 proxies 列表">
          {(id) => <YamlTextarea id={id} rows={18} className="font-mono" spellCheck={false} value={groupText ?? ''} onChange={(event) => setGroupText(event.target.value)} />}
        </Field>
        <FieldError error={groupResult && !groupResult.ok ? `第 ${groupResult.line ?? 1} 行：${groupResult.error}` : undefined} />
      </Modal>
      <DeleteDialog open={deletingNode !== undefined} title={`删除节点「${deletingNode === undefined ? '' : d.proxies[deletingNode]?.name ?? ''}」？`} error={e.save.error} pending={e.save.isPending}
        onClose={() => setDeletingNode(undefined)}
        onConfirm={() => e.save.mutate({ ...d, proxies: d.proxies.filter((_, i) => i !== deletingNode) }, { onSuccess: () => setDeletingNode(undefined) })}>
        节点会从分组「{d.name}」中移除并立即保存{e.dirty ? '；分组里其他未保存的修改也会一起保存' : ''}。
      </DeleteDialog>
      <LeaveDialog blocker={blocker} what={`分组「${d.name}」`} canSave={validName} pending={e.save.isPending} error={e.save.error}
        onSave={(done) => e.save.mutate({ ...d, name: d.name.trim() }, { onSuccess: done })} />
    </>
  );
}

/** /locals/:id/nodes/:index（index 为 new 时新增）：单个节点的编辑子页，保存即写回整个分组 */
export function LocalNodeEdit() {
  const { id, index } = useParams();
  const doc = useDoc('locals', id);
  if (doc.error) return <ErrorAlert error={doc.error} />;
  if (!doc.data) return <div className="text-muted">加载中…</div>;
  const idx = Number(index);
  if (index !== 'new' && !(Number.isInteger(idx) && idx >= 0 && idx < doc.data.proxies.length)) return <Navigate to={`/locals/${id}`} replace />;
  return <LocalNodeEditor key={`${id}-${index}`} group={doc.data} index={index === 'new' ? 'new' : idx} />;
}

function LocalNodeEditor({ group: g, index }: { group: LocalProxyGroup; index: number | 'new' }) {
  const isNew = index === 'new';
  const save = useSaveDoc('locals');
  const [base, setBase] = useState<LocalProxy | undefined>(() => isNew ? undefined : g.proxies[index]);
  const [text, setText] = useState(() => base ? proxyToYaml(base) : '');
  const [savedText, setSavedText] = useState(text);
  const [deleting, setDeleting] = useState(false);
  const settledText = useDebouncedValue(text, 400);
  const checking = text !== settledText;
  const result = inspectLocalNodeYaml(settledText);
  const valid = !checking && result.ok;
  const dirty = text !== savedText;
  const { blocker, leave } = useLeaveGuard(dirty);
  const groupPath = `/locals/${g.id}`;
  const persist = (done?: () => void) => {
    // 保存时重新校验当前文本，绝不使用最后一次成功解析的旧节点。
    const current = inspectLocalNodeYaml(text);
    if (!current.ok || save.isPending) return;
    const cur = current.value;
    const submittedText = text;
    const proxies = isNew ? [...g.proxies, cur] : g.proxies.map((p, i) => i === index ? cur : p);
    save.mutate({ ...g, proxies }, { onSuccess: () => {
      setSavedText(submittedText); setBase(cur);
      if (done) done();
      else if (isNew) leave(`${groupPath}/nodes/${proxies.length - 1}`, { replace: true });
    } });
  };
  const remove = () => save.mutate({ ...g, proxies: g.proxies.filter((_, i) => i !== index) }, { onSuccess: () => leave(groupPath) });
  return <>
    <PageHeader crumbs={<><Link to="/locals" className={crumbLink}>本地节点</Link> / <Link to={groupPath} className={crumbLink}>{g.name}</Link> / {isNew ? '新增节点' : base?.name}</>}
      title={isNew ? '新增节点' : valid && result.ok ? result.value.name : base?.name || '未命名'}
      actions={<>
        <Button variant="primary" onClick={() => persist()} disabled={save.isPending || !valid || !(dirty || isNew)}>{save.isPending ? '保存中…' : isNew ? '添加到分组' : dirty ? '保存节点' : '已保存'}</Button>
        {!isNew && <Button variant="danger" disabled={save.isPending} onClick={() => { save.reset(); setDeleting(true); }}>删除</Button>}
      </>}>
      <Badge>分组 · {g.name}</Badge>
      {dirty && <Badge tone="warn">有未保存的修改</Badge>}
    </PageHeader>
    <ErrorAlert error={save.error} />
    <Card scroll title={<h2 className="m-0 text-[15px] font-semibold">节点配置</h2>}>
      <LocalNodeYamlEditor disabled={save.isPending} text={text} onChange={setText} result={result} checking={checking} />
    </Card>
    <DeleteDialog open={deleting} title={`删除节点「${base?.name ?? ''}」？`} error={save.error} pending={save.isPending}
      onClose={() => setDeleting(false)} onConfirm={remove}>节点会从分组「{g.name}」中移除并立即保存。</DeleteDialog>
    <LeaveDialog blocker={blocker} what={isNew ? '新节点' : `节点「${base?.name ?? ''}」`} canSave={valid} pending={save.isPending} error={save.error}
      onSave={done => persist(done)} />
  </>;
}
