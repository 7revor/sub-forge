import { GroupSettingsFields } from '../../components/GroupSettingsFields.tsx';
import type { GroupSpec, ReportItem } from '@sub-forge/core';
import { ExtraFields } from '../../components/ExtraFields.tsx';
import { memberLabel } from '../../components/pickers.tsx';
import { SortableList } from '../../components/SortableList.tsx';
import { Badge, Button, Card, Empty, Field, Input, Segmented, Switch, cx } from '../../components/ui.tsx';
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
  // 设计稿「管理员 · 模板编辑器」：骨架表格（组 / 类型 / 成员 / 为空时 / 填充提示），点击行在下方展开编辑
  const grid = 'grid grid-cols-[24px_minmax(0,1.1fr)_minmax(0,0.6fr)_minmax(0,1.4fr)_88px_minmax(0,1fr)] items-center gap-3';
  return <Card bodyClass="overflow-x-auto pb-2"
    title={`策略组骨架`} subtitle={`只含其他模板组和内置策略，不含节点，也不预设 filter。`}
    actions={<Button onClick={() => {
      const id = newId('g');
      onChange({ ...value, groups: [...value.groups, { id, name: '新策略组', type: 'select', members: [], whenEmpty: 'reject' }] });
      onSelect(id);
    }}>新增组</Button>}>
    {!value.groups.length ? <div className="px-4 pb-2"><Empty title="还没有组" description="点击「新增组」建立策略组骨架。" /></div> : <div className="min-w-[760px]">
      <div className={cx(grid, 'border-y border-line px-4 py-2 text-[12px] font-medium text-muted')}><span /><span>组</span><span>类型</span><span>成员（组 / 内置）</span><span>为空时</span><span>填充提示</span></div>
      <SortableList items={value.groups} getKey={(g) => g.id} onReorder={(groups) => onChange({ ...value, groups })} renderItem={(g, _i, handle) => {
        const error = report.some((r) => r.level === 'error' && r.where === `group:${g.id}`);
        const open = g.id === group?.id;
        return <div className={cx('border-b border-line-2', error && 'bg-err-soft')}>
          <div className={cx(grid, 'cursor-pointer px-4 py-2.5', open ? 'bg-accent-soft' : 'hover:bg-ground')} onClick={() => onSelect(g.id)}>
            <span onClick={(e) => e.stopPropagation()}>{handle}</span>
            <button type="button" aria-expanded={open} className={cx('cursor-pointer truncate text-left text-[13.5px] font-medium', error && 'text-err')}>{g.name || '未命名组'}</button>
            <span className="font-mono text-[12.5px]">{g.type}</span>
            <span className="truncate text-[12.5px] text-ink-2">{g.members.map((m) => memberLabel(m, groupName, (ref) => ref.id).text).join(' · ') || '—'}</span>
            <button type="button" title="点击切换" onClick={(e) => { e.stopPropagation(); onChange({ ...value, groups: value.groups.map((x) => x.id === g.id ? { ...x, whenEmpty: x.whenEmpty === 'direct' ? 'reject' : 'direct' } : x) }); }}
              className={cx('h-7 w-fit cursor-pointer rounded-md border px-2 text-[12px]', g.whenEmpty === 'direct' ? 'border-[#a9bbea] bg-accent-soft text-accent-ink' : 'border-[#f0b5ae] bg-err-soft text-err')}>{g.whenEmpty === 'direct' ? '直连' : '拒绝'}</button>
            <span className="truncate text-[12.5px] text-muted">{g.hint || '—'}</span>
          </div>
          {open && group && <div key={group.id} id={`template-group-${group.id}`} className="flex min-w-0 flex-col gap-3 border-t border-line-2 bg-ground px-4 py-4">
        <ItemIssues report={report} where={`group:${group.id}`} />
        <Field label="组名称">{(id) => <Input id={id} value={group.name} onChange={(e) => update({ name: e.target.value })} />}</Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><GroupSettingsFields value={group} onChange={(key, next) => update({ [key]: next })} /></div>
        <div className="flex flex-wrap items-center gap-2"><span className="text-[13px] text-muted">为空时</span><Segmented label="为空时" value={group.whenEmpty ?? 'reject'} options={[{ value: 'reject', label: '拒绝' }, { value: 'direct', label: '直连' }]} onChange={(whenEmpty) => update({ whenEmpty })} /></div>
        <Field label="填充提示">{(id) => <Input id={id} value={group.hint ?? ''} onChange={(e) => update({ hint: e.target.value })} />}</Field>
        <div className="flex items-center gap-2"><Switch label="hidden" checked={group.display?.hidden ?? false} onChange={(hidden) => update({ display: { ...group.display, hidden } })} /><span className="text-[13px]">hidden（隐藏）</span></div>
        <Field label="icon（图标）">{(id) => <Input id={id} value={group.display?.icon ?? ''} onChange={(e) => update({ display: { ...group.display, icon: e.target.value } })} />}</Field>
        <ExtraFields value={group.extra ?? {}} onChange={(extra) => update({ extra })} />
        <h3 className="m-0 text-[14px] font-medium">成员</h3>
        {!group.members.length && <Empty title="还没有成员" description="从下方选择其他模板组或内置策略。" />}
        <SortableList items={group.members} onReorder={(members) => update({ members })} renderItem={(m, index, handle) => <div className="flex items-center gap-2 border-b border-line-2 py-1">
          {handle}<span className="min-w-0 flex-1 break-all text-[13px]">{memberLabel(m, groupName, (ref) => ref.id).text}</span>
          <Button size="sm" onClick={() => update({ members: group.members.filter((_, i) => i !== index) })}>删除</Button>
        </div>} />
        <Field label="添加成员（其他模板组 / 内置策略）">{() => <TemplateTargetSelect label="添加成员" value={undefined} groups={value.groups.filter((g) => g.id !== group.id)} onChange={(member) => update({ members: [...group.members, member] })} />}</Field>
        <Button variant="danger" onClick={() => remove(group.id)}>删除组</Button>
      </div>}
        </div>;
      }} />
    </div>}
  </Card>;
}
