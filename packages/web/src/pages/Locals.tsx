import { ActionMenu } from '../components/ActionMenu.tsx';
import { ProfileInfoModal } from './profile/ProfileInfoModal.tsx';
import { PageScroll } from '../components/ui.tsx';
import { createModal, useModalDraft, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '../modals/index.tsx';
import { Frame } from '../modals/Frame.tsx';
import { ResourceLinkButton } from '../components/ResourceLinkButton.tsx';
import { YamlTextarea } from '../components/YamlTextarea.tsx';
import { useLeaveGuard } from '../hooks/useLeaveGuard.ts';
import { NamedCreateDialog } from '../components/NamedCreateDialog.tsx';
// 本地节点使用左右工作区；旧节点子页地址继续定位相应节点。
// 本地节点只录入节点信息，不设置前置：代理链统一在配置订阅的「代理链」中配置（REF-03）。
// 每个分组是一个节点集文档；节点子页直接保存整个分组。离开有未保存修改的页面前先确认。

import type { LocalProxy, LocalProxyGroup } from '@sub-forge/core';
import { Plus, Trash2 } from 'lucide-react';
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
import { Badge, Button, buttonClass, Card, Empty, ErrorAlert, FieldError, Field, Input, PageHeader, cx, listMono } from '../components/ui.tsx';
import { useDocEditor } from '../components/useDocEditor.ts';
import { useDoc, useSaveDoc } from '../hooks.ts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table.tsx';

const EMPTY: LocalProxyGroup = { id: '', name: '', proxies: [] };
const crumbLink = 'text-muted-foreground no-underline';

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

/** 节点草稿按索引隔离，切换节点不丢失原文，保存整个分组后一次性生效。 */
export function LocalEdit() {
  const e = useDocEditor('locals', EMPTY);
  const route = useParams();
  const [selected, setSelected] = useState<number | 'new'>(() => route.index === 'new' ? 'new' : Number(route.index ?? 0));
  const [texts, setTexts] = useState<Record<string, string>>({});
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
  const persist = async () => {
    if (!d || invalid || !validName) return;
    const saved = await e.save.mutateAsync({ ...d, name: d.name.trim(), proxies: [...proxies, ...(newResult?.ok ? [newResult.value] : [])] });
    e.setDraft(saved); setTexts({}); if (selected === 'new') setSelected(saved.proxies.length - 1);
  };
  const { leave } = useLeaveGuard(dirty && !!d && !e.isNew, undefined, () => ({ what: `分组「${d?.name}」`, canSave: validName && !invalid, onSave: persist }));
  if (e.isNew) return <Navigate to="/locals" replace />;
  if (!d) return e.doc.error ? <ErrorAlert error={e.doc.error} /> : <div className="text-muted-foreground">加载中…</div>;
  const active = selected === 'new' ? undefined : proxies[selected];
  const text = texts[selected] ?? (active ? proxyToYaml(active) : '');
  const result = inspectLocalNodeYaml(text);
  return <>
    <PageHeader crumbs={<><Link to="/locals" className={crumbLink}>本地节点</Link> / {d.name}</>} title={d.name || '未命名'} subtitle={`${proxies.length} 个节点`}
      actions={<><ResourceLinkButton kind="locals" id={d.id} name={d.name} disabled={dirty} /><Button disabled={invalid} onClick={async () => { const result = await LocalGroupYamlModal.show({ proxies: [...proxies, ...(newResult?.ok ? [newResult.value] : [])] }); if (result.status === 'confirmed') { e.setDraft({ ...d, proxies: result.data }); setTexts({}); setSelected(0); } }}>编辑分组 YAML</Button>
        <Button variant="primary" onClick={() => void persist()} disabled={e.save.isPending || !dirty || !validName || invalid}>{e.save.isPending ? '保存中…' : dirty ? '保存' : '已保存'}</Button>
        <ActionMenu size="md"><Button onClick={async () => { const result = await ProfileInfoModal.show({ name: d.name, note: d.note }); if (result.status === 'confirmed') e.setDraft({ ...d, ...result.data }); }}>编辑名称与备注</Button><Button variant="danger" onClick={async () => { const result = await Frame.modal.confirm({ title: `删除分组「${d.name}」？`, description: GROUP_DELETE_BODY, danger: true, confirmLabel: '删除' }, { submit: async () => { await e.del.mutateAsync(d.id); } }); if (result.status === 'confirmed') leave('/locals'); }}>删除分组…</Button></ActionMenu>
      </>}>{dirty && <Badge tone="warn">未保存</Badge>}</PageHeader>
    <ErrorAlert error={e.save.error} />
    <PageScroll contained><div className="grid min-h-0 gap-5 lg:min-h-[calc(100dvh-178px)] lg:grid-cols-[minmax(320px,.933fr)_minmax(0,1.067fr)]">
      <Card title="节点" count={proxies.length} className="flex min-h-0 flex-col overflow-hidden" bodyClass="min-h-0 flex-1 overflow-auto p-0!" actions={<Button size="sm" onClick={() => { setSelected('new'); setTexts(current => ({ ...current, new: current.new ?? '' })); }}><Plus size={16} />新增节点</Button>}>
        <Table className="table-fixed" containerClassName="overflow-visible"><TableHeader><TableRow><TableHead>名称</TableHead><TableHead className="w-20">协议</TableHead><TableHead>服务器</TableHead></TableRow></TableHeader><TableBody>
          {proxies.map((proxy, index) => <TableRow key={index} className={cx('hover:bg-accent', selected === index && 'bg-primary/10')}>
            <TableCell><button type="button" className="w-full cursor-pointer truncate text-left font-medium" onClick={() => setSelected(index)}>{proxy.name}</button></TableCell>
            <TableCell><span className="rounded bg-secondary font-mono text-xs px-1.5 py-0.5 text-xs">{proxy.type.toUpperCase()}</span></TableCell>
            <TableCell className="truncate font-mono text-xs" title={`${proxy.server}:${proxy.port}`}>{proxy.server}:{proxy.port}</TableCell>
          </TableRow>)}
        </TableBody></Table>{!proxies.length && <Empty title="还没有节点" />}
      </Card>
      <Card actions={(active || selected === 'new') && <Button size="sm" variant="ghost" aria-label="删除当前节点" disabled={e.save.isPending || invalid || (selected !== 'new' && !!newResult)} onClick={() => { if (selected === 'new') { setTexts(current => { const next = { ...current }; delete next.new; return next; }); } else { e.setDraft({ ...d, proxies: proxies.filter((_, i) => i !== selected) }); setTexts({}); } setSelected(0); }}><Trash2 size={15} /></Button>} title={active?.name ?? (selected === 'new' ? '新增节点' : '节点配置')} subtitle={active ? `${active.type.toUpperCase()} · ${active.server}:${active.port}` : undefined} className="flex min-h-0 flex-col overflow-hidden" bodyClass="min-h-0 flex-1 overflow-auto px-5 pb-5">
        {(active || selected === 'new') ? <LocalNodeYamlEditor key={selected} disabled={e.save.isPending} text={text} onChange={text => setTexts(current => ({ ...current, [selected]: text }))} result={result} checking={false} /> : <Empty title="选择左侧节点进行编辑" />}
      </Card>
    </div></PageScroll>
  </>;
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
