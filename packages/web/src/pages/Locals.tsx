import { createModal, useModalDraft, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '../modals/index.tsx';
import { Frame } from '../modals/Frame.tsx';
import { ResourceLinkButton } from '../components/ResourceLinkButton.tsx';
import { YamlTextarea } from '../components/YamlTextarea.tsx';
import { useLeaveGuard } from '../hooks/useLeaveGuard.ts';
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
import { DeleteAction, ActionButtons } from '../components/DetailActions.tsx';
import { Badge, Button, buttonClass, Card, Empty, ErrorAlert, FieldError, Field, Input, PageHeader, cx, listMono, td, th } from '../components/ui.tsx';
import { useDocEditor } from '../components/useDocEditor.ts';
import { useDoc, useSaveDoc } from '../hooks.ts';

const EMPTY: LocalProxyGroup = { id: '', name: '', proxies: [] };
const crumbLink = 'text-ink-muted no-underline';

const typesText = (g: LocalProxyGroup) => [...new Set(g.proxies.map((p) => p.type))].join(' / ') || '—';

const GROUP_DELETE_BODY = '分组里的节点会一起删除；引用它的配置订阅需要先移除。';

/** /locals：分组列表，与订阅源列表同一形态 */
export function LocalList() {
  const navigate = useNavigate(); const save = useSaveDoc('locals', true);
  const create = async () => {
    let createdId: string | undefined;
    const result = await NamedCreateDialog.show({ title: '新建分组', label: '分组名称', placeholder: '例如：自建、家宽', note: true }, { submit: async ({ name, note }) => { createdId = (await save.mutateAsync({ name, note, proxies: [] })).id; } });
    if (result.status === 'confirmed' && createdId) navigate(`/locals/${createdId}`);
  };
  return (
    <>
      <DocList kind="locals" title="本地节点" noun="分组" onCreate={create} deleteBody={GROUP_DELETE_BODY}
        columns={[
          { header: '名称', cell: (g) => g.name },
          { header: '备注', cell: (g) => <NoteCell note={g.note} /> },
          { header: '节点', width: 80, cell: (g) => <span className={listMono}>{g.proxies.length}</span> },
          { header: '协议', width: 200, cell: (g) => <span className="font-mono text-[12.5px] text-ink-2">{typesText(g)}</span> },
        ]} />
    </>
  );
}

/** /locals/:id：分组详情，节点表的「编辑」「新增节点」进入节点子页 */
export function LocalEdit() {
  const e = useDocEditor('locals', EMPTY);
  const { blocker, leave } = useLeaveGuard(e.dirty && !e.isNew, undefined, () => ({ what: `分组「${d.name}」`, canSave: validName, onSave: () => e.save.mutateAsync({ ...d, name: d.name.trim() }) }));
  if (e.isNew) return <Navigate to="/locals" replace />;
  if (!e.draft) return e.doc.error ? <ErrorAlert error={e.doc.error} /> : <div className="text-ink-muted">加载中…</div>;
  const d = e.draft;
  const validName = !!d.name.trim();
  const setProxies = (proxies: LocalProxy[]) => e.setDraft({ ...d, proxies });
  const nodePath = (i: number | 'new') => `/locals/${d.id}/nodes/${i}`;

  return (
    <>
      <PageHeader crumbs={<><Link to="/locals" className={crumbLink}>本地节点</Link> / {e.doc.data?.name}</>}
        title={d.name || '未命名'}
        actions={<>
          <ResourceLinkButton kind="locals" id={d.id} name={d.name} disabled={e.dirty} />
          <ActionButtons items={[{ label: '分组 YAML', onSelect: async () => { const result = await LocalGroupYamlModal.show({ proxies: d.proxies }); if (result.status === 'confirmed') setProxies(result.data); } }]} />
          <Button variant="primary" onClick={() => e.submit((draft) => ({ ...draft, name: draft.name.trim() }))} disabled={e.save.isPending || !e.dirty || !validName}>{e.save.isPending ? '保存中…' : e.dirty ? '保存分组' : '已保存'}</Button>
          <DeleteAction what="分组" name={d.name} body={GROUP_DELETE_BODY} error={e.del.error} pending={e.del.isPending} onReset={e.del.reset}
            onDelete={() => e.del.mutateAsync(d.id)} onDeleted={() => leave('/locals')} />
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
                    <Button size="sm" variant="danger" aria-label={`删除 ${p.name}`} className="mr-2" onClick={() => { e.save.reset(); void Frame.modal.confirm({ title: `删除节点「${p.name}」？`, description: `节点会从分组「${d.name}」中移除并立即保存${e.dirty ? '；其他未保存的修改也会一起保存' : ''}。`, confirmLabel: '删除', danger: true }, { submit: async () => { const item = await e.save.mutateAsync({ ...d, proxies: d.proxies.filter((_, index) => index !== i) }); e.setDraft(item); } }); }}>删除</Button>
                    <DocActionLink to={nodePath(i)} name={p.name} />
                  </td>
                </DocTableRow>
              ))}
            </tbody>
          </table>
        )}
      </Card>


    </>
  );
}

/** /locals/:id/nodes/:index（index 为 new 时新增）：单个节点的编辑子页，保存即写回整个分组 */
export function LocalNodeEdit() {
  const { id, index } = useParams();
  const doc = useDoc('locals', id);
  if (doc.error) return <ErrorAlert error={doc.error} />;
  if (!doc.data) return <div className="text-ink-muted">加载中…</div>;
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
  const settledText = useDebouncedValue(text, 400);
  const checking = text !== settledText;
  const result = inspectLocalNodeYaml(settledText);
  const valid = !checking && result.ok;
  const dirty = text !== savedText;
  const { blocker, leave } = useLeaveGuard(dirty, undefined, () => ({ what: isNew ? '新节点' : `节点「${base?.name ?? ''}」`, canSave: valid, onSave: () => persist(true) }));
  const groupPath = `/locals/${g.id}`;
  const persist = async (leaving = false) => {
    // 保存时重新校验当前文本，绝不使用最后一次成功解析的旧节点。
    const current = inspectLocalNodeYaml(text);
    if (!current.ok || save.isPending) return;
    const cur = current.value;
    const submittedText = text;
    const proxies = isNew ? [...g.proxies, cur] : g.proxies.map((p, i) => i === index ? cur : p);
    await save.mutateAsync({ ...g, proxies });
    setSavedText(submittedText); setBase(cur);
    if (!leaving && isNew) leave(`${groupPath}/nodes/${proxies.length - 1}`, { replace: true });
  };
  const remove = async () => { const result = await Frame.modal.confirm({ title: `删除节点「${base?.name ?? ''}」？`, description: `节点会从分组「${g.name}」中移除并立即保存。`, confirmLabel: '删除', danger: true }, { submit: async () => { await save.mutateAsync({ ...g, proxies: g.proxies.filter((_, i) => i !== index) }); } }); if (result.status === 'confirmed') leave(groupPath); };
  return <>
    <PageHeader crumbs={<><Link to="/locals" className={crumbLink}>本地节点</Link> / <Link to={groupPath} className={crumbLink}>{g.name}</Link> / {isNew ? '新增节点' : base?.name}</>}
      title={isNew ? '新增节点' : valid && result.ok ? result.value.name : base?.name || '未命名'}
      actions={<>
        <Button variant="primary" onClick={() => persist()} disabled={save.isPending || !valid || !(dirty || isNew)}>{save.isPending ? '保存中…' : isNew ? '添加到分组' : dirty ? '保存节点' : '已保存'}</Button>
        {!isNew && <Button variant="danger" disabled={save.isPending} onClick={() => { save.reset(); void remove(); }}>删除</Button>}
      </>}>
      <Badge>分组 · {g.name}</Badge>
      {dirty && <Badge tone="warn">有未保存的修改</Badge>}
    </PageHeader>
    <ErrorAlert error={save.error} />
    <Card scroll title={<h2 className="m-0 text-[15px] font-semibold">节点配置</h2>}>
      <LocalNodeYamlEditor disabled={save.isPending} text={text} onChange={setText} result={result} checking={checking} />
    </Card>

  </>;
}

const LocalGroupYamlModal = createModal<{ proxies: LocalProxy[] }, LocalProxy[]>(function GroupYaml({ data, modal }) {
  const [text, setText] = useModalDraft(() => groupToYaml(data.proxies));
  const result = groupFromYaml(text);
  return <ModalContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl"><ModalHeader><ModalTitle>分组 YAML</ModalTitle></ModalHeader>
    <Field label="整个分组的 proxies 列表">{id => <YamlTextarea placeholder="粘贴本地节点组的 YAML 配置" id={id} rows={18} spellCheck={false} value={text} onChange={event => setText(event.target.value)} />}</Field>
    <FieldError error={!result.ok ? `第 ${result.line ?? 1} 行：${result.error}` : undefined} />
    <ModalFooter><Button onClick={modal.cancel}>取消</Button><Button variant="primary" disabled={!result.ok} onClick={() => { if (result.ok) modal.confirm(result.value); }}>保存</Button></ModalFooter>
  </ModalContent>;
});
