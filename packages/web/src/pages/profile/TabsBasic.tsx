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
import { Button, Card, Empty, Field, Segmented, Select } from '../../components/ui.tsx';
import { useProfile } from './context.ts';

/** 输出设置与基本信息放在同一个标签页。 */
export function TabOutput() {
  const { draft, setDraft, allNodeSets } = useProfile();
  const userinfo = draft.userinfo ?? { mode: 'sum' as const };
  const sources = allNodeSets.filter(n => n.ref.type === 'source' && draft.nodeSets.some(p => p.ref.type === 'source' && p.ref.id === n.ref.id));
  return <Card title="输出设置" className="min-w-0">
    <div className="flex flex-col gap-3.5">
      <Field label="流量 / 到期信息">{id => <Select placeholder="选择订阅流量与到期信息的来源" id={id} value={userinfo.mode === 'source' ? `source:${userinfo.sourceId}` : userinfo.mode} onChange={e => {
        const value = e.target.value;
        setDraft({ ...draft, userinfo: value.startsWith('source:') ? { mode: 'source', sourceId: value.slice(7) } : { mode: value as 'sum' | 'none' } });
      }}>
        <option value="sum">汇总全部订阅源</option>
        {sources.map(s => <option key={s.ref.id} value={`source:${s.ref.id}`}>取「{s.name}」</option>)}
        <option value="none">不输出</option>
      </Select>}</Field>
      <p className="m-0 text-[12.5px] text-ink-muted">更新间隔由管理员在系统中统一设置。</p>
    </div>
  </Card>;
}

/** 按内核和可选客户端保存原文，编辑阶段不做字段解析。 */
export function TabBase() {
  const { draft, setDraft } = useProfile();
  const enabled = draft.base !== undefined && draft.base.enabled !== false;
  return <>
    {(draft.migrationNotes ?? []).map((note, i) => <p key={i} role="status" className="text-[13px] text-warn">{note}</p>)}
    <section className="flex flex-wrap items-center gap-4 rounded-[10px] border border-line bg-panel p-4">
      <Field label="基础配置追加">{() => <Segmented label="基础配置追加" value={enabled ? 'enabled' : 'disabled'} options={[{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '不输出' }]} onChange={m => {
        setDraft({ ...draft, base: { ...draft.base, enabled: m === 'enabled' } });
      }} />}</Field>
    </section>
    {enabled && <NativeBaseEditor value={draft.base ?? {}} onChange={base => setDraft({ ...draft, base: { ...base, enabled: true } })} />}
  </>;
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
