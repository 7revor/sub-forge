import { createModal, useModalDraft, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '../../modals/index.tsx';
import { Frame } from '../../modals/Frame.tsx';
import { compileUserRegex, type GroupSpec, type ReportItem } from '@sub-forge/core';
import { Layers3, Plus } from 'lucide-react';

import { GroupSettingsFields } from '../../components/GroupSettingsFields.tsx';

import { memberLabel } from '../../components/pickers.tsx';
import { TemplateBoundList } from '../../components/TemplateBoundList.tsx';
import { SortableList } from '../../components/SortableList.tsx';
import { RoutingCard, RoutingCardActions, RoutingCardIcon } from '../../components/RoutingCard.tsx';
import { Button, Card, Empty, Field, Input, Switch, cx } from '../../components/ui.tsx';
import { ExcludeTypeSelect } from '../../components/ExcludeTypeSelect.tsx';
import { newId, type TemplateBody } from '../../convert/templateYaml.ts';
import { ItemIssues, TemplateTargetSelect } from './TemplateFields.tsx';
import { removeGroup } from './model.ts';
import { createRegionGroups, REGION_GROUPS } from '../../convert/regionGroups.ts';

const columns = 'grid grid-cols-[24px_32px_minmax(0,1fr)_60px] md:grid-cols-[24px_32px_minmax(0,1fr)_88px_minmax(0,1.4fr)_44px_60px]';

export function TemplateGroupsEditor({ value, onChange, report, readOnly = false, isGroupReadOnly = () => readOnly, onRemoveGroup, onEditGroup, memberSummary, nodeSetName = ref => ref.id, templateGroupIds, templateStart }: {
  value: TemplateBody; onChange: (body: TemplateBody, templateStart?: number) => void; report: ReportItem[];
  templateGroupIds?: string[]; templateStart?: number;
  isGroupReadOnly?: (group: GroupSpec) => boolean; onRemoveGroup?: (group: GroupSpec) => void;
  readOnly?: boolean; onEditGroup?: (group: GroupSpec, adding: boolean) => void; memberSummary?: (group: GroupSpec) => string; nodeSetName?: (ref: import('@sub-forge/core').NodeSetID) => string;
}) {
  const groupName = (id: string) => value.groups.find(g => g.id === id)?.name ?? id;
  const edit = async (group: GroupSpec, adding = false) => {
    if (onEditGroup) { onEditGroup(group, adding); return; }
    const result = await TemplateGroupModal.show({ group, groups: value.groups, report, readOnly });
    if (result.status === 'confirmed') onChange({ ...value, groups: adding ? [...value.groups, result.data] : value.groups.map(g => g.id === group.id ? result.data : g) });
  };
  const remove = async (group: GroupSpec) => {
    if (onRemoveGroup) { onRemoveGroup(group); return; }
    const references = value.groups.filter(g => g.id !== group.id && g.members.some(m => m.kind === 'group' && m.groupId === group.id)).length;
    const rules = value.rules.filter(r => r.target.kind === 'group' && r.target.groupId === group.id).length;
    const final = value.final.kind === 'group' && value.final.groupId === group.id;
    const result = await Frame.modal.confirm({ title: `删除策略组「${group.name || '未命名组'}」？`, description: `删除此组会移除 ${references} 个组内的引用，将 ${rules} 条规则${final ? '和 MATCH' : ''}的出口改为 REJECT。`, confirmLabel: '删除', danger: true });
    if (result.status === 'confirmed') onChange(removeGroup(value, group.id));
  };
  return <>
    <Card title="策略组" actions={!readOnly && <>
      <Button size="sm" disabled={REGION_GROUPS.every(region => value.groups.some(g => g.name === region.name))} onClick={() => {
        const added = createRegionGroups(value.groups);
        onChange({ ...value, groups: [...value.groups, ...added] });
      }}>添加地区节点</Button>
      <Button size="sm" onClick={() => {
        const id = newId('g');
        void edit({ id, name: '新策略组', type: 'select', members: [] }, true);
      }}><Plus size={14} />新增组</Button>
    </>}>
      {!value.groups.length ? <Empty title="还没有策略组" /> : <>
        <TemplateBoundList label="策略组" items={value.groups} templateIds={templateGroupIds} templateStart={templateStart} isLocked={isGroupReadOnly} canDrop={(_from, to) => !isGroupReadOnly(value.groups[to]!)} onReorder={(groups, start) => onChange({ ...value, groups }, start)} renderItem={(g, _i, handle) => {
          const error = report.some(r => r.level === 'error' && r.where === `group:${g.id}`);
          const members = memberSummary?.(g) ?? (g.members.map(m => memberLabel(m, groupName, nodeSetName).text).join(' · ') || '—');
          return <RoutingCard id={`template-group-${g.id}`} className={columns} invalid={error}>
            {handle}
            <RoutingCardIcon><Layers3 size={16} /></RoutingCardIcon>
            <span title={g.name || '未命名组'} className={cx('min-w-0 truncate text-left font-medium', error && 'text-err')}>{g.name || '未命名组'}</span>
            <div className="col-span-2 col-start-3 row-start-2 flex min-w-0 items-center gap-3 md:contents">
              <span className="shrink-0 text-ink-2" title="策略组类型">{g.type.toUpperCase()}</span>
              <span className="min-w-0 flex-1 truncate text-ink-2" title={members}>{members}</span>
              <div className="flex shrink-0 items-center" title="隐藏策略组">
                <Switch disabled={isGroupReadOnly(g)} label={`隐藏策略组「${g.name || '未命名组'}」`} checked={g.display?.hidden ?? false} onChange={hidden => onChange({ ...value, groups: value.groups.map(item => item.id === g.id ? { ...item, display: { ...item.display, hidden } } : item) })} />
              </div>
            </div>
            <div className="col-start-4 row-start-1 md:col-start-7">
              <RoutingCardActions label={`策略组「${g.name}」`} onEdit={() => void edit(g)} onDelete={isGroupReadOnly(g) ? undefined : () => void remove(g)} />
            </div>
          </RoutingCard>;
        }} />
      </>}
    </Card>
  </>;
}

export const TemplateGroupModal = createModal<{ group: GroupSpec; groups: GroupSpec[]; report: ReportItem[]; readOnly: boolean }, GroupSpec>(function TemplateGroup({ data: { groups, report, readOnly, group: initial }, modal }) {
  const [group, setGroup] = useModalDraft(initial);
  const value = { groups };
  const errors: ReportItem[] = [];
  const issue = (message: string) => errors.push({ level: 'error', code: 'group.draft', where: `group:${group.id}`, message });
  if (!group.name.trim()) issue('请填写策略组名称');
  if (groups.some(g => g.id !== group.id && g.name.trim() === group.name.trim())) issue('策略组名称不能重复');
  for (const [name, expression] of [['filter', group.filter], ['exclude-filter', group.excludeFilter]]) {
    if (expression) try { compileUserRegex(expression); } catch (error) { issue(`${name} 无效：${(error as Error).message}`); }
  }
  const groupName = (id: string) => groups.find(g => g.id === id)?.name ?? id;
  const update = (patch: Partial<GroupSpec>) => setGroup(current => ({ ...current, ...patch }));
  return <ModalContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl" aria-describedby={undefined}><ModalHeader><ModalTitle>{group ? `编辑策略组 · ${group.name || '未命名组'}` : '编辑策略组'}</ModalTitle></ModalHeader><div className="flex min-h-0 flex-col gap-3.5">
      <>
        <ItemIssues report={errors} where={`group:${group.id}`} />
        
        <fieldset disabled={readOnly} className="m-0 contents border-0 p-0">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="组名称">{id => <Input placeholder="填写策略组在配置中的名称" id={id} value={group.name} onChange={e => update({ name: e.target.value })} />}</Field>
          <GroupSettingsFields section="type" disabled={readOnly} value={group} onChange={(key, next) => update({ [key]: next })} />
        </div>
        <details className="mt-4"><summary className="cursor-pointer text-[13px] font-medium">高级设置</summary><div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <GroupSettingsFields section="advanced" disabled={readOnly} value={group} onChange={(key, next) => update({ [key]: next })} />
          <Field label="filter（保留）" hint="订阅填入节点集后生效">{id => <Input id={id} className="font-mono" placeholder="输入保留节点的正则表达式" value={group.filter ?? ''} onChange={e => update({ filter: e.target.value || undefined })} />}</Field>
          <Field label="exclude-filter（剔除）">{id => <Input id={id} className="font-mono" placeholder="输入剔除节点的正则表达式" value={group.excludeFilter ?? ''} onChange={e => update({ excludeFilter: e.target.value || undefined })} />}</Field>
          <Field label="exclude-type（排除协议）">{id => <ExcludeTypeSelect disabled={readOnly} id={id} value={group.excludeType} onChange={excludeType => update({ excludeType })} />}</Field>
        </div></details>
        </fieldset>
        
        <section className="flex min-w-0 flex-col gap-3" aria-label="策略组成员">
          <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="m-0 text-[14px] font-semibold">成员 <span className="ml-2 text-[12px] font-normal text-ink-muted">{group.members.length} 个</span></h3>
            <TemplateTargetSelect action label="添加成员" value={undefined} groups={value.groups.filter(g => g.id !== group.id)} onChange={member => update({ members: [...group.members, member] })} />
          </div>
          {!group.members.length ? <Empty title="还没有成员" /> : <div className="rounded-lg border border-line px-3">
            <SortableList items={group.members} onReorder={members => update({ members })} renderItem={(m, index, handle) => <div className="flex items-center gap-2 border-b border-line-2 py-2 last:border-0">
              {handle}<span className="min-w-0 flex-1 break-all text-[13px]">{memberLabel(m, groupName, ref => ref.id).text}</span>
              <Button size="sm" onClick={() => update({ members: group.members.filter((_, i) => i !== index) })}>删除</Button>
            </div>} />
          </div>}
        </section>
      </>
    </div><ModalFooter>{<><Button onClick={modal.cancel}>取消</Button><Button variant="primary" disabled={!!errors.length} onClick={() => modal.confirm(group)}>保存</Button></>}</ModalFooter></ModalContent>;
});
