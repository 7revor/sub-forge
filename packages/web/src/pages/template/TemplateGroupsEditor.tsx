import type { GroupSpec, ReportItem } from '@sub-forge/core';
import { ExtraFields } from '../../components/ExtraFields.tsx';
import { memberLabel } from '../../components/pickers.tsx';
import { SortableList } from '../../components/SortableList.tsx';
import { Badge, Button, Card, Field, Input, Segmented, Select, Switch, cx } from '../../components/ui.tsx';
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
  return <Card title="策略组">
    <div className="flex flex-wrap items-start gap-4">
      <div className="min-w-0 flex-[1_1_200px]">
        <SortableList items={value.groups} getKey={(g) => g.id} onReorder={(groups) => onChange({ ...value, groups })} renderItem={(g, _i, handle) => {
          const error = report.some((r) => r.level === 'error' && r.where === `group:${g.id}`);
          return <div className={cx('mb-2 flex items-center rounded-lg border p-2', error ? 'border-err bg-err-soft' : g.id === group?.id ? 'border-accent bg-accent-soft' : 'border-line')}>
            {handle}<button type="button" aria-pressed={g.id === group?.id} onClick={() => onSelect(g.id)} className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1 text-left">
              <span className={cx('break-all text-[13px] font-medium', error && 'text-err')}>{g.name || '未命名组'}</span>
              <span className="text-[12px] text-muted">{g.type} · {g.members.length} 个成员</span>
              <span><Badge tone={g.whenEmpty === 'direct' ? 'accent' : 'err'}>为空时{g.whenEmpty === 'direct' ? '直连' : '拒绝'}</Badge></span>
            </button>
          </div>;
        }} />
        <Button onClick={() => {
          const id = newId('g');
          onChange({ ...value, groups: [...value.groups, { id, name: '新策略组', type: 'select', members: [], whenEmpty: 'reject' }] });
          onSelect(id);
        }}>新增组</Button>
      </div>
      {group && <div key={group.id} id={`template-group-${group.id}`} className="flex min-w-0 flex-[2_1_320px] flex-col gap-3">
        <ItemIssues report={report} where={`group:${group.id}`} />
        <Field label="组名称">{(id) => <Input id={id} value={group.name} onChange={(e) => update({ name: e.target.value })} />}</Field>
        <Field label="类型">{(id) => <Select id={id} value={group.type} onChange={(e) => update({ type: e.target.value as GroupSpec['type'] })}>
          {['select', 'url-test', 'fallback', 'load-balance'].map((type) => <option key={type}>{type}</option>)}
        </Select>}</Field>
        <div className="flex flex-wrap items-center gap-2"><span className="text-[13px] text-muted">为空时</span><Segmented label="为空时" value={group.whenEmpty ?? 'reject'} options={[{ value: 'reject', label: '拒绝' }, { value: 'direct', label: '直连' }]} onChange={(whenEmpty) => update({ whenEmpty })} /></div>
        <Field label="填充提示">{(id) => <Input id={id} value={group.hint ?? ''} onChange={(e) => update({ hint: e.target.value })} />}</Field>
        {group.type !== 'select' && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(['url', 'interval', 'timeout', 'maxFailedTimes', 'expectedStatus', ...(group.type === 'url-test' ? ['tolerance'] as const : [])] as const).map((key) => {
            const numeric = !['url', 'expectedStatus'].includes(key);
            const label = key === 'maxFailedTimes' ? 'max-failed-times' : key === 'expectedStatus' ? 'expected-status' : key;
            return <Field key={key} label={label}>{(id) => <Input id={id} type={numeric ? 'number' : 'text'} min={numeric ? 0 : undefined} value={group.test?.[key] ?? ''} onChange={(e) => update({ test: { ...group.test, [key]: e.target.value === '' ? undefined : numeric ? Number(e.target.value) : e.target.value } })} />}</Field>;
          })}
          <div className="flex items-center gap-2"><Switch label="lazy" checked={group.test?.lazy ?? false} onChange={(lazy) => update({ test: { ...group.test, lazy } })} /><span className="text-[13px]">lazy</span></div>
          {group.type === 'load-balance' && <Field label="strategy">{(id) => <Select id={id} value={group.strategy ?? ''} onChange={(e) => update({ strategy: (e.target.value || undefined) as GroupSpec['strategy'] })}>
            <option value="">默认</option>{['consistent-hashing', 'round-robin', 'sticky-sessions'].map((s) => <option key={s}>{s}</option>)}
          </Select>}</Field>}
        </div>}
        <div className="flex items-center gap-2"><Switch label="hidden" checked={group.display?.hidden ?? false} onChange={(hidden) => update({ display: { ...group.display, hidden } })} /><span className="text-[13px]">hidden（隐藏）</span></div>
        <Field label="icon（图标）">{(id) => <Input id={id} value={group.display?.icon ?? ''} onChange={(e) => update({ display: { ...group.display, icon: e.target.value } })} />}</Field>
        <ExtraFields value={group.extra ?? {}} onChange={(extra) => update({ extra })} />
        <h3 className="m-0 text-[14px] font-medium">成员</h3>
        <SortableList items={group.members} onReorder={(members) => update({ members })} renderItem={(m, index, handle) => <div className="flex items-center gap-2 border-b border-line-2 py-1">
          {handle}<span className="min-w-0 flex-1 break-all text-[13px]">{memberLabel(m, groupName, (ref) => ref.id).text}</span>
          <Button size="sm" onClick={() => update({ members: group.members.filter((_, i) => i !== index) })}>删除</Button>
        </div>} />
        <Field label="添加成员（其他模板组 / 内置策略）">{() => <TemplateTargetSelect label="添加成员" value={undefined} groups={value.groups.filter((g) => g.id !== group.id)} onChange={(member) => update({ members: [...group.members, member] })} />}</Field>
        <Button variant="danger" onClick={() => remove(group.id)}>删除组</Button>
      </div>}
    </div>
  </Card>;
}
