import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog.tsx';
import type { GroupSpec, ReportItem } from '@sub-forge/core';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { GroupSettingsFields } from '../../components/GroupSettingsFields.tsx';
import { DeleteDialog } from '../../components/DetailActions.tsx';
import { memberLabel } from '../../components/pickers.tsx';
import { SortableList } from '../../components/SortableList.tsx';
import { Button, Card, Empty, Field, Input, Switch, cx } from '../../components/ui.tsx';
import { ExcludeTypeSelect } from '../../components/ExcludeTypeSelect.tsx';
import { newId, type TemplateBody } from '../../convert/templateYaml.ts';
import { ItemIssues, TemplateTargetSelect } from './TemplateFields.tsx';
import { removeGroup } from './model.ts';
import { createRegionGroups, REGION_GROUPS } from '../../convert/regionGroups.ts';

const columns = 'grid grid-cols-[24px_minmax(0,1fr)_90px_64px] gap-x-2 sm:grid-cols-[24px_minmax(0,1fr)_110px_minmax(0,1.4fr)_56px_64px]';

function SettingsSection({ readOnly, children }: { readOnly: boolean; children: ReactNode }) {
  return readOnly ? <details className="flex flex-col gap-4"><summary className="cursor-pointer text-[13px] text-ink-muted">模板组设置 · 只读</summary>{children}</details> : <>{children}</>;
}

export function TemplateGroupsEditor({ value, onChange, selected, onSelect, report, readOnly = false, saveHint = '保存模板后生效', renderMembers, memberSummary, nodeSetName = ref => ref.id }: {
  value: TemplateBody; onChange: (body: TemplateBody) => void; selected: string | undefined; onSelect: (id: string | undefined) => void; report: ReportItem[];
  readOnly?: boolean; saveHint?: string; renderMembers?: (group: GroupSpec) => ReactNode; memberSummary?: (group: GroupSpec) => string; nodeSetName?: (ref: import('@sub-forge/core').NodeSetID) => string;
}) {
  const [deleting, setDeleting] = useState<string>();
  const deletingGroup = value.groups.find(g => g.id === deleting);
  const group = value.groups.find(g => g.id === selected);
  const groupName = (id: string) => value.groups.find(g => g.id === id)?.name ?? id;
  const update = (patch: Partial<GroupSpec>) => {
    if (group) onChange({ ...value, groups: value.groups.map(g => g.id === group.id ? { ...g, ...patch } : g) });
  };
  const close = () => { onSelect(undefined); setDeleting(undefined); };
  const references = deletingGroup ? value.groups.filter(g => g.id !== deletingGroup.id && g.members.some(m => m.kind === 'group' && m.groupId === deletingGroup.id)).length : 0;
  const rules = deletingGroup ? value.rules.filter(r => r.target.kind === 'group' && r.target.groupId === deletingGroup.id).length : 0;
  const final = deletingGroup && value.final.kind === 'group' && value.final.groupId === deletingGroup.id;
  return <>
    <Card title="策略组" subtitle={`${value.groups.length} 个`} bodyClass="pb-1" actions={!readOnly && <>
      <Button size="sm" disabled={REGION_GROUPS.every(region => value.groups.some(g => g.name === region.name))} onClick={() => {
        const added = createRegionGroups(value.groups);
        onChange({ ...value, groups: [...value.groups, ...added] });
      }}>添加地区节点</Button>
      <Button size="sm" onClick={() => {
        const id = newId('g');
        onChange({ ...value, groups: [...value.groups, { id, name: '新策略组', type: 'select', members: [] }] });
        onSelect(id);
      }}><Plus size={14} />新增组</Button>
    </>}>
      {!value.groups.length ? <div className="px-4 pb-4"><Empty title="还没有策略组" /></div> : <>
        <div className={cx(columns, 'items-center px-4 pb-2 text-[12px] font-medium text-ink-muted')}><span /><span>组</span><span>类型</span><span className="hidden sm:block">成员</span><span className="hidden text-center sm:block">隐藏</span><span className="sr-only">操作</span></div>
        <SortableList items={value.groups} getKey={g => g.id} isLocked={() => readOnly} onReorder={groups => onChange({ ...value, groups })} renderItem={(g, _i, handle) => {
          const error = report.some(r => r.level === 'error' && r.where === `group:${g.id}`);
          const members = memberSummary?.(g) ?? (g.members.map(m => memberLabel(m, groupName, nodeSetName).text).join(' · ') || '—');
          return <div className={cx(columns, 'items-center border-t border-line-2 px-4 py-2.5 text-[13px] hover:bg-ground', error && 'bg-err-soft')}>
            {handle}
            <span title={g.name || '未命名组'} className={cx('min-w-0 truncate text-left font-medium', error && 'text-err')}>{g.name || '未命名组'}{g.display?.hidden && <span className="ml-2 text-[11px] font-normal text-ink-muted">已隐藏</span>}</span>
            <span className="font-mono text-[12px]">{g.type.toUpperCase()}</span>
            <span className="col-span-2 col-start-2 row-start-2 truncate text-[12.5px] text-ink-2 sm:col-span-1 sm:col-start-4 sm:row-start-1" title={members}>{members}</span>
            <div className="col-start-4 row-start-2 flex flex-col items-center justify-center gap-0.5 sm:col-start-5 sm:row-start-1 sm:flex-row">
              <span className="text-[12px] text-ink-muted sm:hidden">隐藏</span>
              {readOnly ? <span className="text-[12px] text-ink-muted">{g.display?.hidden ? '是' : '否'}</span> : <Switch label={`隐藏策略组「${g.name || '未命名组'}」`} checked={g.display?.hidden ?? false} onChange={hidden => onChange({ ...value, groups: value.groups.map(item => item.id === g.id ? { ...item, display: { ...item.display, hidden } } : item) })} />}
            </div>
            <div className="col-start-4 row-start-1 flex gap-1 sm:col-start-6">
              <Button size="sm" variant="ghost" className="px-1.5" aria-label={`编辑策略组「${g.name}」`} onClick={() => onSelect(g.id)}><Pencil size={14} /></Button>
              {!readOnly && <Button size="sm" variant="ghost" className="px-1.5 hover:text-err" aria-label={`删除策略组「${g.name}」`} onClick={() => setDeleting(g.id)}><Trash2 size={14} /></Button>}
            </div>
          </div>;
        }} />
      </>}
    </Card>
    <Dialog open={!!group && !deletingGroup} onOpenChange={next => { if (!next) (close)(); }}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl" aria-describedby={undefined}><DialogHeader><DialogTitle>{group ? `编辑策略组 · ${group.name || '未命名组'}` : '编辑策略组'}</DialogTitle></DialogHeader><div className="flex min-h-0 flex-col gap-3.5">
      {group && <>
        <ItemIssues report={report} where={`group:${group.id}`} />
        <SettingsSection readOnly={readOnly}>
        <fieldset disabled={readOnly} className="m-0 contents border-0 p-0">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="组名称">{id => <Input placeholder="填写策略组在配置中的名称" id={id} value={group.name} onChange={e => update({ name: e.target.value })} />}</Field>
          <GroupSettingsFields value={group} onChange={(key, next) => update({ [key]: next })} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="filter（保留）" hint="订阅填入节点集后生效">{id => <Input id={id} className="font-mono" placeholder="输入保留节点的正则表达式" value={group.filter ?? ''} onChange={e => update({ filter: e.target.value || undefined })} />}</Field>
          <Field label="exclude-filter（剔除）">{id => <Input id={id} className="font-mono" placeholder="输入剔除节点的正则表达式" value={group.excludeFilter ?? ''} onChange={e => update({ excludeFilter: e.target.value || undefined })} />}</Field>
          <Field label="exclude-type（排除协议）">{id => <ExcludeTypeSelect id={id} value={group.excludeType} onChange={excludeType => update({ excludeType })} />}</Field>
        </div>
        </fieldset>
        </SettingsSection>
        {renderMembers ? renderMembers(group) : <section className="flex min-w-0 flex-col gap-3" aria-label="策略组成员">
          <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="m-0 text-[14px] font-semibold">成员 <span className="ml-2 text-[12px] font-normal text-ink-muted">{group.members.length} 个</span></h3>
            <TemplateTargetSelect action label="添加成员" value={undefined} groups={value.groups.filter(g => g.id !== group.id)} onChange={member => update({ members: [...group.members, member] })} />
          </div>
          {!group.members.length ? <Empty title="还没有成员" /> : <div className="rounded-lg border border-line px-3">
            <SortableList items={group.members} onReorder={members => update({ members })} renderItem={(m, index, handle) => <div className="flex items-center gap-2 border-b border-line-2 py-2 last:border-0">
              {handle}<span className="min-w-0 flex-1 break-all text-[13px]">{memberLabel(m, groupName, ref => ref.id).text}</span>
              <Button size="sm" onClick={() => update({ members: group.members.filter((_, i) => i !== index) })}>删除</Button>
            </div>} />
          </div>}
        </section>}
      </>}
    </div><DialogFooter>{<><span className="mr-auto self-center text-[12px] text-ink-muted">{saveHint}</span><Button variant="primary" onClick={close}>完成</Button></>}</DialogFooter></DialogContent></Dialog>
    <DeleteDialog open={!!deletingGroup} title={`删除策略组「${deletingGroup?.name || '未命名组'}」？`} onClose={() => setDeleting(undefined)} onConfirm={() => {
      if (!deletingGroup) return;
      onChange(removeGroup(value, deletingGroup.id));
      if (selected === deletingGroup.id) onSelect(undefined);
      setDeleting(undefined);
    }}>
      <p className="mt-0">删除此组会移除 {references} 个组内的引用，将 {rules} 条规则{final ? '和 MATCH' : ''}的出口改为 REJECT。</p>
      <p className="mb-0 text-ink-muted">{saveHint}。</p>
    </DeleteDialog>
  </>;
}
