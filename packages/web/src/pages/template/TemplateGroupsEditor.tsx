import type { GroupSpec, ReportItem } from '@sub-forge/core';
import { GroupSettingsFields } from '../../components/GroupSettingsFields.tsx';
import { memberLabel } from '../../components/pickers.tsx';
import { SortableList } from '../../components/SortableList.tsx';
import { Button, Card, Empty, Field, Input, Segmented, Switch, cx } from '../../components/ui.tsx';
import { newId, type TemplateBody } from '../../convert/templateYaml.ts';
import { ItemIssues, TemplateTargetSelect } from './TemplateFields.tsx';
import { removeGroup } from './model.ts';

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
  return <Card title={`策略组（${value.groups.length}）`} bodyClass="border-t border-line"
    actions={<Button onClick={() => {
      const id = newId('g');
      onChange({ ...value, groups: [...value.groups, { id, name: '新策略组', type: 'select', members: [], whenEmpty: 'reject' }] });
      onSelect(id);
    }}>新增组</Button>}>
    {!group ? <div className="p-4"><Empty title="还没有组" /></div> : <div className="grid min-w-0 md:grid-cols-[240px_minmax(0,1fr)]">
      <nav aria-label="策略组列表" className="min-w-0 border-b border-line p-3 md:border-r md:border-b-0">
        <SortableList items={value.groups} getKey={(g) => g.id} onReorder={(groups) => onChange({ ...value, groups })} renderItem={(g, _i, handle) => {
          const error = report.some((r) => r.level === 'error' && r.where === `group:${g.id}`);
          return <div className={cx('mb-1 flex items-center gap-1 rounded-lg border p-2', g.id === group.id ? 'border-accent bg-accent-soft' : 'border-transparent hover:bg-ground')}>
            {handle}
            <button type="button" aria-current={g.id === group.id ? 'true' : undefined} onClick={() => onSelect(g.id)} className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1 text-left">
              <span className={cx('w-full truncate text-[13.5px] font-semibold', error && 'text-err')}>{g.name || '未命名组'}</span>
              <span className="text-[12px] text-muted">{g.type} · {g.members.length} 个成员{error ? ' · 待修复' : ''}</span>
            </button>
          </div>;
        }} />
      </nav>
      <div key={group.id} id={`template-group-${group.id}`} className="flex min-w-0 flex-col gap-5 rounded-b-[10px] bg-panel p-4 md:rounded-bl-none md:rounded-br-[10px] md:p-5">
        <ItemIssues report={report} where={`group:${group.id}`} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="组名称">{(id) => <Input id={id} value={group.name} onChange={(e) => update({ name: e.target.value })} />}</Field>
          <GroupSettingsFields value={group} onChange={(key, next) => update({ [key]: next })} />
        </div>
        <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
          <div className="flex flex-col gap-1.5"><span className="text-[12.5px] font-medium text-muted">为空时</span><Segmented label="为空时" value={group.whenEmpty ?? 'reject'} options={[{ value: 'reject', label: '拒绝' }, { value: 'direct', label: '直连' }]} onChange={(whenEmpty) => update({ whenEmpty })} /></div>
          <div className="flex h-[38px] items-center gap-2"><Switch label="隐藏策略组" checked={group.display?.hidden ?? false} onChange={(hidden) => update({ display: { ...group.display, hidden } })} /><span className="text-[13px]">隐藏策略组</span></div>
        </div>
        <section className="flex min-w-0 flex-col gap-3 border-t border-line pt-4" aria-label="策略组成员">
          <div className="flex items-center justify-between"><h3 className="m-0 text-[14px] font-semibold">成员</h3><span className="text-[12px] text-muted">{group.members.length} 个</span></div>
          <Field label="添加成员">{() => <TemplateTargetSelect label="添加成员" value={undefined} groups={value.groups.filter((g) => g.id !== group.id)} onChange={(member) => update({ members: [...group.members, member] })} />}</Field>
          {!group.members.length ? <Empty title="还没有成员" /> : <div className="rounded-lg border border-line bg-panel px-3">
            <SortableList items={group.members} onReorder={(members) => update({ members })} renderItem={(m, index, handle) => <div className="flex items-center gap-2 border-b border-line-2 py-2 last:border-0">
              {handle}<span className="min-w-0 flex-1 break-all text-[13px]">{memberLabel(m, groupName, (ref) => ref.id).text}</span>
              <Button size="sm" onClick={() => update({ members: group.members.filter((_, i) => i !== index) })}>删除</Button>
            </div>} />
          </div>}
        </section>
        <div className="flex justify-end border-t border-line pt-4"><Button variant="danger" size="sm" onClick={() => remove(group.id)}>删除组</Button></div>
      </div>
    </div>}
  </Card>;
}
