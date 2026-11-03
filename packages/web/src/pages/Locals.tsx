import { ActionMenu } from '../components/ActionMenu.tsx';
import { createModal, useModalDraft, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '../modals/index.tsx';
import { Frame } from '../modals/Frame.tsx';
import { ResourceLinkButton } from '../components/ResourceLinkButton.tsx';
import { YamlTextarea } from '../components/YamlTextarea.tsx';
import { useLeaveGuard } from '../hooks/useLeaveGuard.ts';
import { NamedCreateDialog } from '../components/NamedCreateDialog.tsx';
// 本地节点使用左右工作区：左侧可排序的节点列表，右侧单节点编辑器；旧节点子页地址继续定位相应节点。
// 本地节点只录入节点信息，不设置前置：代理链统一在配置订阅的「代理链」中配置（REF-03）。
// 每个分组是一个节点集文档；节点子页直接保存整个分组。离开有未保存修改的页面前先确认。

import type { LocalProxy, LocalProxyGroup } from '@sub-forge/core';
import { arrayMove } from '@dnd-kit/sortable';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { NoteCell, NoteField } from '../components/DocNote.tsx';
import { DocList } from '../components/DocList.tsx';
import { LocalNodeYamlEditor } from '../components/LocalNodeYamlEditor.tsx';
import { SortableList } from '../components/SortableList.tsx';
import { inspectLocalNodeYaml } from '../convert/localNodeYaml.ts';
import { groupFromYaml, groupToYaml, proxyToYaml } from '../convert/proxyYaml.ts';
import { movedIndex, moveNodeTexts, removeNodeText, type NodeTexts } from '../domain/localNodeDrafts.ts';
import { Badge, Button, Card, Empty, ErrorAlert, FieldError, Field, Input, PageHeader, PageScroll, cx, listMono } from '../components/ui.tsx';
import { Card as ShadcnCard } from '../components/ui/card.tsx';
import { useDocEditor } from '../components/useDocEditor.ts';
import { useSaveDoc } from '../hooks.ts';

const EMPTY: LocalProxyGroup = { id: '', name: '', proxies: [] };
const crumbLink = 'text-muted-foreground no-underline';
const paneHeader = 'flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2';

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
          { header: '协议', width: 200, cell: (g) => <span className="font-mono text-sm text-foreground">{typesText(g)}</span> },
        ]} />
    </>
  );
}

/** 节点草稿按下标隔离，切换和排序都不丢失原文；未选中节点时右侧就是新增草稿。保存整个分组后一次性生效。 */
export function LocalEdit() {
  const e = useDocEditor('locals', EMPTY);
  const route = useParams();
  const [selected, setSelected] = useState<number | 'new'>(() => route.index === 'new' ? 'new' : Number(route.index ?? 0));
  const [texts, setTexts] = useState<NodeTexts>({});
  useEffect(() => { setTexts({}); setSelected(route.index === 'new' ? 'new' : Number(route.index ?? 0)); }, [route.id, route.index]);
  const d = e.draft;
  const proxies = d?.proxies.map((proxy, index) => {
    const text = texts[index];
    if (text === undefined) return proxy;
    const parsed = inspectLocalNodeYaml(text);
    return parsed.ok ? parsed.value : proxy;
  }) ?? [];
  const newResult = texts.new !== undefined ? inspectLocalNodeYaml(texts.new) : undefined;
  const invalid = Object.values(texts).some(text => !inspectLocalNodeYaml(text).ok);
  const dirty = e.dirty || Object.entries(texts).some(([key, text]) => key === 'new' || text !== proxyToYaml(d!.proxies[Number(key)]!));
  const validName = !!d?.name.trim();
  const current = selected !== 'new' && proxies[selected] ? selected : 'new';
  const persist = async () => {
    if (!d || invalid || !validName) return;
    const saved = await e.save.mutateAsync({ ...d, name: d.name.trim(), proxies: [...proxies, ...(newResult?.ok ? [newResult.value] : [])] });
    e.setDraft(saved); setTexts({}); if (current === 'new' && newResult?.ok) setSelected(saved.proxies.length - 1);
  };
  const { leave } = useLeaveGuard(dirty && !!d && !e.isNew, undefined, () => ({ what: `分组「${d?.name}」`, canSave: validName && !invalid, onSave: persist }));
  if (e.isNew) return <Navigate to="/locals" replace />;
  if (!d) return e.doc.error ? <ErrorAlert error={e.doc.error} /> : <div className="text-muted-foreground">加载中…</div>;
  const active = current === 'new' ? undefined : proxies[current];
  const text = texts[current] ?? (active ? proxyToYaml(active) : '');
  const result = inspectLocalNodeYaml(text);
  const edit = (next: string) => setTexts(({ [current]: _, ...rest }) => current === 'new' && !next.trim() ? rest : { ...rest, [current]: next });
  const addNew = () => {
    if (!newResult?.ok) return;
    const index = d.proxies.length;
    e.setDraft({ ...d, proxies: [...d.proxies, newResult.value] });
    setTexts(({ new: pasted, ...rest }) => ({ ...rest, [index]: pasted! }));
    setSelected(index);
  };
  const remove = (index: number) => {
    const rest = d.proxies.filter((_, i) => i !== index);
    e.setDraft({ ...d, proxies: rest });
    setTexts(current => removeNodeText(current, index));
    setSelected(rest.length ? Math.min(index, rest.length - 1) : 'new');
  };
  return <>
    <PageHeader crumbs={<><Link to="/locals" className={crumbLink}>本地节点</Link> / {d.name}</>} title={d.name || '未命名'} subtitle={`${proxies.length} 个节点`}
      actions={<><ResourceLinkButton kind="locals" id={d.id} name={d.name} disabled={dirty} /><Button disabled={invalid} onClick={async () => { const result = await LocalGroupYamlModal.show({ proxies: [...proxies, ...(newResult?.ok ? [newResult.value] : [])] }); if (result.status === 'confirmed') { e.setDraft({ ...d, proxies: result.data }); setTexts({}); setSelected(0); } }}>编辑分组 YAML</Button>
        <Button variant="primary" onClick={() => void persist()} disabled={e.save.isPending || !dirty || !validName || invalid}>{e.save.isPending ? '保存中…' : dirty ? '保存' : '已保存'}</Button>
        <ActionMenu size="md"><Button variant="danger" onClick={async () => { const result = await Frame.modal.confirm({ title: `删除分组「${d.name}」？`, description: GROUP_DELETE_BODY, danger: true, confirmLabel: '删除' }, { submit: async () => { await e.del.mutateAsync(d.id); } }); if (result.status === 'confirmed') leave('/locals'); }}>删除分组…</Button></ActionMenu>
      </>}>{dirty && <Badge tone="warn">未保存</Badge>}</PageHeader>
    <ErrorAlert error={e.save.error} />
    <PageScroll className="local-workspace">
      <Card className="flex-none!" bodyClass="grid gap-4 sm:grid-cols-[1fr_2fr]">
        <Field label="名称">{id => <Input id={id} placeholder="填写分组名称，例如：自建、家宽" value={d.name} aria-invalid={!validName} onChange={event => e.setDraft({ ...d, name: event.target.value })} />}</Field>
        <NoteField compact value={d.note} onChange={note => e.setDraft({ ...d, note })} />
      </Card>
      <ShadcnCard className="gap-0 overflow-hidden py-0 lg:grid lg:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]">
        <section aria-label="节点列表" className="flex min-h-0 flex-col border-b border-border lg:border-r lg:border-b-0">
          <header className={paneHeader}>
            <h2 className="m-0 text-sm font-semibold">节点<span className="ml-1.5 font-normal text-muted-foreground">{proxies.length}</span></h2>
            <Button size="sm" disabled={current === 'new'} onClick={() => setSelected('new')}><Plus size={16} />新增节点</Button>
          </header>
          {/* 节点行拦截点击，落到这里的都是空白处：取消选择，右侧转为新增。 */}
          <div data-testid="local-node-list" className="min-h-0 flex-1 overflow-y-auto p-2" onClick={() => setSelected('new')}>
            {!proxies.length && !texts.new && <Empty title="还没有节点，在右侧粘贴配置后添加" />}
            <SortableList items={proxies} draggingClassName="[&>*]:bg-card [&>*]:shadow-md" onReorder={(_, { from, to }) => {
              e.setDraft({ ...d, proxies: arrayMove(d.proxies, from, to) });
              setTexts(current => moveNodeTexts(current, from, to));
              if (current !== 'new') setSelected(movedIndex(current, from, to));
            }} renderItem={(proxy, index, handle) => <NodeRow proxy={proxy} selected={current === index} broken={texts[index] !== undefined && !inspectLocalNodeYaml(texts[index]!).ok} handle={handle} onSelect={() => setSelected(index)} />} />
            {current !== 'new' && texts.new && <NodeRow label="未添加的新节点" selected={false} broken={!newResult?.ok} onSelect={() => setSelected('new')} />}
          </div>
        </section>
        <section aria-label="节点配置" className="flex min-w-0 flex-col">
          <header className={paneHeader}>
            <div className="min-w-0">
              <h2 className="m-0 truncate text-sm font-semibold">{active?.name ?? '新增节点'}</h2>
              <p className="m-0 truncate text-xs text-muted-foreground">{active ? `${active.type.toUpperCase()} · ${active.server}:${active.port}` : '粘贴或输入配置后添加到列表'}</p>
            </div>
            {current === 'new'
              ? <Button size="sm" disabled={e.save.isPending || !newResult?.ok} onClick={addNew}><Plus size={16} />添加</Button>
              : <Button size="sm" variant="ghost" aria-label="删除当前节点" disabled={e.save.isPending} onClick={() => remove(current)}><Trash2 size={15} /></Button>}
          </header>
          <LocalNodeYamlEditor key={current} autoFocus={selected === 'new'} disabled={e.save.isPending} text={text} onChange={edit} result={result} checking={false} />
        </section>
      </ShadcnCard>
    </PageScroll>
  </>;
}

/** 整行可点选；拖动手柄是行内的独立控件，新增草稿行没有手柄。 */
function NodeRow({ proxy, label, selected, broken, handle, onSelect }: { proxy?: LocalProxy; label?: string; selected: boolean; broken: boolean; handle?: ReactNode; onSelect: () => void }) {
  const address = proxy && `${proxy.server}:${proxy.port}`;
  return <div className={cx('flex items-center gap-1 rounded-lg pl-1 hover:bg-accent', !handle && 'pl-7', selected && 'bg-primary/10 hover:bg-primary/10')} onClick={event => { event.stopPropagation(); onSelect(); }}>
    {handle}
    <button type="button" aria-current={selected || undefined} className="grid min-w-0 flex-1 cursor-pointer gap-0.5 py-2 pr-3 text-left">
      <span className="flex min-w-0 items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">{proxy?.name ?? label}</span>
        {broken ? <Badge tone="err" className="shrink-0">配置有误</Badge> : proxy && <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 font-mono text-xs">{proxy.type.toUpperCase()}</span>}
      </span>
      {address && <span title={address} className="truncate font-mono text-xs text-muted-foreground">{address}</span>}
    </button>
  </div>;
}

/** /locals/:id/nodes/:index（index 为 new 时新增）：单个节点的编辑子页，保存即写回整个分组 */
export function LocalNodeEdit() { return <LocalEdit />; }

const LocalGroupYamlModal = createModal<{ proxies: LocalProxy[] }, LocalProxy[]>(function GroupYaml({ data, modal }) {
  const [text, setText] = useModalDraft(() => groupToYaml(data.proxies));
  const result = groupFromYaml(text);
  return <ModalContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl"><ModalHeader><ModalTitle>分组 YAML</ModalTitle></ModalHeader>
    <Field label="整个分组的 proxies 列表">{id => <YamlTextarea placeholder="粘贴本地节点组的 YAML 配置" id={id} rows={18} spellCheck={false} value={text} onChange={event => setText(event.target.value)} />}</Field>
    <FieldError error={!result.ok ? `第 ${result.line ?? 1} 行：${result.error}` : undefined} />
    <ModalFooter><Button onClick={modal.cancel}>取消</Button><Button variant="primary" disabled={!result.ok} onClick={() => { if (result.ok) modal.confirm(result.value); }}>保存</Button></ModalFooter>
  </ModalContent>;
});
