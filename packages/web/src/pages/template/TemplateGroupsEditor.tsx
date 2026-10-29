import type { GroupSpec, ReportItem } from '@sub-forge/core';
import { GroupSettingsFields } from '../../components/GroupSettingsFields.tsx';
import { memberLabel } from '../../components/pickers.tsx';
import { SortableList } from '../../components/SortableList.tsx';
import { Button, Empty, Field, Input, Switch, cx } from '../../components/ui.tsx';
import { ExcludeTypeSelect } from '../../components/ExcludeTypeSelect.tsx';
import { newId, type TemplateBody } from '../../convert/templateYaml.ts';
import { ItemIssues, TemplateTargetSelect } from './TemplateFields.tsx';
import { removeGroup } from './model.ts';
import { createRegionGroups, REGION_GROUPS } from '../../convert/regionGroups.ts';

export function TemplateGroupsEditor({ value, onChange, selected, onSelect, report }: {
  value: TemplateBody; onChange: (value: TemplateBody) => void; selected: string | undefined; onSelect: (id: string) => void; report: ReportItem[];
}) {
  const group = value.groups.find((g) => g.id === selected) ?? value.groups[0];
  const update = (patch: Partial<GroupSpec>) => {
    if (group) onChange({ ...value, groups: value.groups.map((g) => g.id === group.id ? { ...g, ...patch } : g) });
  };
  const groupName = (id: string) => value.groups.find((g) => g.id === id)?.name ?? id;
  const remove = (id: string) => {
    const affected = value.groups.filter((g) => g.id !== id && g.members.some((m) => m.kind === 'group' && m.groupId === id));
    const rules = value.rules.filter((r) => r.target.kind === 'group' && r.target.groupId === id);
    const final = value.final.kind === 'group' && value.final.groupId === id;
    if (!window.confirm(`删除「${groupName(id)}」？\n影响 ${affected.length} 个组${affected.length ? `（${affected.map((g) => g.name).join('、')}）` : ''}、${rules.length} 条规则${final ? '及 MATCH 出口' : ''}。\n确认后移除引用成员，相关规则和 MATCH 出口改为 REJECT。`)) return;
    onChange(removeGroup(value, id));
  };
  return <section className="-mx-4">
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
      <h2 className="m-0 text-[15px] font-semibold">策略组（{value.groups.length}）</h2>
      <div className="flex flex-wrap gap-2"><Button disabled={REGION_GROUPS.every(region => value.groups.some(group => group.name === region.name))} onClick={() => {
        const added = createRegionGroups(value.groups);
        onChange({ ...value, groups: [...value.groups, ...added] });
        if (added[0]) onSelect(added[0].id);
      }}>添加地区节点</Button><Button onClick={() => {
        const id = newId('g');
        onChange({ ...value, groups: [...value.groups, { id, name: '新策略组', type: 'select', members: [] }] });
        onSelect(id);
      }}>新增组</Button></div>
    </div>
    {!group ? <div className="p-4"><Empty title="还没有组" /></div> : <div className="grid min-w-0 md:grid-cols-[240px_minmax(0,1fr)]">
      <nav aria-label="策略组列表" className="min-w-0 border-b border-line p-3 md:border-r md:border-b-0">
        <SortableList items={value.groups} getKey={(g) => g.id} onReorder={(groups) => onChange({ ...value, groups })} renderItem={(g, _i, handle) => {
          const error = report.some((r) => r.level === 'error' && r.where === `group:${g.id}`);
          return <div className={cx('mb-1 flex items-center gap-1 rounded-lg border p-2', g.id === group.id ? 'border-accent bg-accent-soft' : 'border-transparent hover:bg-ground')}>
            {handle}
            <button type="button" aria-current={g.id === group.id ? 'true' : undefined} onClick={() => onSelect(g.id)} className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1 text-left">
              <span className={cx('w-full truncate text-[13.5px] font-semibold', error && 'text-err')}>{g.name || '未命名组'}</span>
              <span className="text-[12px] text-muted">{g.type.toUpperCase()} · {g.members.length} 个成员{error ? ' · 待修复' : ''}</span>
            </button>
            <div className="flex shrink-0 flex-col items-center gap-1">
              <span className="text-[11px] text-muted">隐藏</span>
              <Switch label={`隐藏策略组「${g.name || '未命名组'}」`} checked={g.display?.hidden ?? false} onChange={(hidden) => onChange({ ...value, groups: value.groups.map((item) => item.id === g.id ? { ...item, display: { ...item.display, hidden } } : item) })} />
            </div>
          </div>;
        }} />
      </nav>
      <div key={group.id} id={`template-group-${group.id}`} className="flex min-w-0 flex-col gap-4 p-4">
        <ItemIssues report={report} where={`group:${group.id}`} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="组名称">{(id) => <Input id={id} value={group.name} onChange={(e) => update({ name: e.target.value })} />}</Field>
          <GroupSettingsFields value={group} onChange={(key, next) => update({ [key]: next })} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="filter（保留）" hint="订阅填入节点集后生效">{(id) => <Input id={id} className="font-mono" value={group.filter ?? ''} onChange={(event) => update({ filter: event.target.value || undefined })} />}</Field>
          <Field label="exclude-filter（剔除）">{(id) => <Input id={id} className="font-mono" value={group.excludeFilter ?? ''} onChange={(event) => update({ excludeFilter: event.target.value || undefined })} />}</Field>
          <Field label="exclude-type（排除协议）">{(id) => <ExcludeTypeSelect id={id} value={group.excludeType} onChange={(excludeType) => update({ excludeType })} />}</Field>
        </div>
        <section className="flex min-w-0 flex-col gap-3" aria-label="策略组成员">
          <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="m-0 text-[14px] font-semibold">成员 <span className="ml-2 text-[12px] font-normal text-muted">{group.members.length} 个</span></h3>
            <TemplateTargetSelect action label="添加成员" value={undefined} groups={value.groups.filter((g) => g.id !== group.id)} onChange={(member) => update({ members: [...group.members, member] })} />
          </div>
          {!group.members.length ? <Empty title="还没有成员" /> : <div className="rounded-lg border border-line bg-panel px-3">
            <SortableList items={group.members} onReorder={(members) => update({ members })} renderItem={(m, index, handle) => <div className="flex items-center gap-2 border-b border-line-2 py-2 last:border-0">
              {handle}<span className="min-w-0 flex-1 break-all text-[13px]">{memberLabel(m, groupName, (ref) => ref.id).text}</span>
              <Button size="sm" onClick={() => update({ members: group.members.filter((_, i) => i !== index) })}>删除</Button>
            </div>} />
          </div>}
        </section>
        <div className="flex justify-end pt-2"><Button variant="danger" size="sm" onClick={() => remove(group.id)}>删除组</Button></div>
      </div>
    </div>}
  </section>;
}
