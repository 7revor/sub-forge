import { MultiSelect } from '../../components/listbox.tsx';
import { useList } from '../../hooks.ts';
import { trafficSourceIds } from './traffic.ts';
import { NativeBaseEditor } from '../../components/NativeBaseEditor.tsx';
import { RoutingCard, RoutingCardIcon } from '../../components/RoutingCard.tsx';
import { SortableList } from '../../components/SortableList.tsx';
import { appendProviderGroup } from './providerGroup.ts';
import type { NodeSetID } from '@sub-forge/core';
import { chainUsesNodeSet, landingNodeName, removeProfileNodeSet } from './chainModel.ts';
import { Frame } from '../../modals/Frame.tsx';
import { NODE_SET_LABEL } from '../../domain/nodeSet.ts';
import { ResourceFileLink } from '../../components/ResourceLinkButton.tsx';
import { NodeSetCount } from '../../components/NodeSetCount.tsx';
// 订阅页共用的基本设置、输出设置和节点配置。

import { Plus, Trash2, Boxes, ListPlus } from 'lucide-react';
import { NodeSetPickerDialog } from '../../components/dialogs.tsx';
import { Button, Card, Empty, Field, Input, Segmented, Switch, Textarea } from '../../components/ui.tsx';
import { useProfile } from './context.ts';

/** 名称、备注和流量信息放在同一行，配置原文使用独立编辑区。 */
export function TabProfileInfo() {
  const { draft, setDraft, allNodeSets } = useProfile();
  const collections = useList('collections');
  const sources = allNodeSets.filter(n => n.ref.type === 'source');
  const selected = trafficSourceIds(draft, collections.data ?? []);
  return <section aria-label="订阅基本信息" className="grid min-w-0 gap-4 rounded-[10px] border border-line bg-panel p-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1.2fr]">
    <div className="min-w-0">
      <Field label="订阅名称">{id => <Input id={id} required placeholder="例如：日常使用" value={draft.name} aria-invalid={!!draft.id && !draft.name.trim()} onChange={e => setDraft({ ...draft, name: e.target.value })} />}</Field>
      {!!draft.id && !draft.name.trim() && <p role="alert" className="mt-1 mb-0 text-[12px] text-err">请填写订阅名称</p>}
    </div>
    <Field label="流量 / 到期信息" className="min-w-0">{id => <MultiSelect placeholder="选择节点订阅（可多选）" id={id} value={selected}
      onChange={sourceIds => setDraft({ ...draft, userinfo: { mode: 'sources', sourceIds } })}>
      {sources.map(s => <option key={s.ref.id} value={s.ref.id}>{s.name}</option>)}
      {selected.filter(id => !sources.some(s => s.ref.id === id)).map(id => <option key={id} value={id}>已不存在：{id}</option>)}
    </MultiSelect>}</Field>
    <Field label="备注" className="min-w-0 sm:col-span-2 xl:col-span-1">{id => <Textarea id={id} rows={1} className="min-h-[38px] resize-y" placeholder="记录用途或说明（可选）" value={draft.note ?? ''} onChange={e => setDraft({ ...draft, note: e.target.value })} />}</Field>
  </section>;
}

/** 启用开关与两层原文集中展示；暂停输出只隐藏编辑区，不清空草稿。 */
export function TabBase() {
  const { draft, setDraft } = useProfile();
  const enabled = draft.base !== undefined && draft.base.enabled !== false;
  return <section aria-label="基础配置追加" className="min-w-0 rounded-[10px] border border-line bg-panel">
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
      <h2 className="m-0 text-[15px] font-semibold">配置追加</h2>
      <div className="flex items-center gap-2.5">
        <span className="text-[12.5px] text-ink-2">{enabled ? '已启用' : '未启用'}</span>
        <Switch label="启用基础配置追加" checked={enabled} onChange={value => setDraft({ ...draft, base: { ...draft.base, enabled: value } })} />
      </div>
    </div>
    {!enabled && <p className="m-0 px-4 pb-5 text-[13px] text-ink-muted sm:px-5">启用后编辑追加配置。</p>}
    <div hidden={!enabled}>
      <NativeBaseEditor value={draft.base ?? {}} onChange={base => setDraft({ ...draft, base: { ...base, enabled: true } })} />
    </div>
    {!!draft.migrationNotes?.length && <details className="px-4 pb-4 text-[12px] sm:px-5">
      <summary className="w-fit cursor-pointer text-warn">配置迁移记录（{draft.migrationNotes.length}）</summary>
      <div className="mt-2 space-y-2 leading-relaxed text-ink-muted">{draft.migrationNotes.map((note, i) => <p key={i} className="m-0">{note}</p>)}</div>
    </details>}
  </section>;
}

/** 节点集（设计稿「Profile · 节点集」）：表格 + 添加对话框，下方说明两种输出方式 */
export function TabNodeSets() {
  const { draft, setDraft, allNodeSets, nodeSetName, groupName, groups } = useProfile();
  const remove = async (ref: NodeSetID) => {
    const affected = draft.chains.filter(c => chainUsesNodeSet(c, ref));
    if (affected.length) {
      const chains = affected.map(c => `${c.via.kind === 'group' ? groupName(c.via.groupId) : c.via.kind === 'builtin' ? c.via.name : 'exact' in c.via.ref.match ? c.via.ref.match.exact : '筛选节点'} → ${landingNodeName(c.landing) ?? (c.landing.filter || c.landing.excludeFilter ? '筛选节点' : '全部节点')}`).join('\n');
      const result = await Frame.modal.confirm({ title: `移出节点集「${nodeSetName(ref)}」？`, description: `以下 ${affected.length} 条代理链引用了此节点集，将一起移除。保存订阅后生效。\n\n${chains}`, confirmLabel: '移出并移除代理链', danger: true });
      if (result.status !== 'confirmed') return;
    }
    setDraft(removeProfileNodeSet(draft, ref));
  };
  return (
    <>
      <Card title="节点来源" subtitle={`${draft.nodeSets.length} 个`}
        actions={<Button size="sm" onClick={async () => { const result = await NodeSetPickerDialog.show({ options: allNodeSets, added: draft.nodeSets.map(n => n.ref) }); if (result.status === 'confirmed') setDraft({ ...draft, nodeSets: [...draft.nodeSets, ...result.data.map(ref => ({ ref, output: 'provider' as const }))] }); }}><Plus size={14} />添加节点集</Button>}>
        {!draft.nodeSets.length ? <Empty title="还没有节点集" /> : <SortableList items={draft.nodeSets} getKey={n => `${n.ref.type}:${n.ref.id}`} onReorder={nodeSets => setDraft({ ...draft, nodeSets })} renderItem={(n, i, handle) => <RoutingCard className="grid grid-cols-[24px_32px_minmax(0,1fr)_68px] md:grid-cols-[24px_32px_minmax(0,1fr)_minmax(0,1fr)_140px_68px]">
          {handle}<RoutingCardIcon><Boxes size={16} /></RoutingCardIcon>
          <ResourceFileLink kind={n.ref.type === 'source' ? 'sources' : n.ref.type === 'collection' ? 'collections' : 'locals'} id={n.ref.id} name={nodeSetName(n.ref)} className="min-w-0 cursor-pointer truncate rounded text-left font-medium no-underline hover:text-brand hover:underline focus-visible:outline-brand" />
          <span className="col-start-3 row-start-2 min-w-0 truncate text-ink-2 md:col-auto md:row-auto">{NODE_SET_LABEL[n.ref.type]} · <NodeSetCount nodeSet={n.ref} /> 个节点</span>
          <div className="col-span-2 col-start-3 row-start-3 w-[140px] md:col-auto md:row-auto [&>div]:w-full [&_button]:flex-1 [&_button]:px-0"><Segmented label={`${nodeSetName(n.ref)}输出方式`} size="sm" value={n.output} options={[{ value: 'provider', label: 'Provider' }, { value: 'inline', label: 'Inline' }]} onChange={output => setDraft({ ...draft, nodeSets: draft.nodeSets.map((x, j) => j === i ? { ...x, output } : x) })} /></div>
          <div className="col-start-4 row-start-1 grid w-[68px] grid-cols-2 gap-1 md:col-auto md:row-auto">
            {n.output === 'provider' ? <Button size="sm" variant="ghost" className="w-8 px-0" aria-label={`为 ${nodeSetName(n.ref)} 追加独立策略组`} title="追加独立策略组" onClick={() => setDraft(appendProviderGroup(draft, n.ref, nodeSetName(n.ref), groups))}><ListPlus size={14} /></Button> : <span aria-hidden="true" className="size-8" />}
            <Button size="sm" variant="ghost" className="w-8 px-0" aria-label={`移除 ${nodeSetName(n.ref)}`} title="移除节点来源" onClick={() => void remove(n.ref)}><Trash2 size={14} /></Button>
          </div>
        </RoutingCard>} />}
      </Card>

    </>
  );
}
