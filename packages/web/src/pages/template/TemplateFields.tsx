import type { Builtin, ReportItem, Target } from '@sub-forge/core';
import { BUILTINS } from '../../components/pickers.tsx';
import { buttonClass, ReportList, Select } from '../../components/ui.tsx';
import type { NamedRef } from '../../convert/templateYaml.ts';
import { RoutingTargetMenu } from '../../components/RoutingTargetMenu.tsx';

export function TemplateTargetSelect({ value, onChange, groups, label, action = false }: {
  value: Target | undefined; onChange: (value: Extract<Target, { kind: 'group' | 'builtin' }>) => void; groups: NamedRef[]; label: string; action?: boolean;
}) {
  const key = value?.kind === 'group' ? (value.groupId ? `group:${value.groupId}` : '') : value?.kind === 'builtin' ? `builtin:${value.name}` : '';
  const missing = value?.kind === 'group' && !!value.groupId && !groups.some((g) => g.id === value.groupId);
  const select = (key: string) => {
    if (key.startsWith('group:')) onChange({ kind: 'group', groupId: key.slice(6) });
    else if (key.startsWith('builtin:')) onChange({ kind: 'builtin', name: key.slice(8) as Builtin });
  };
  if (!action) return <RoutingTargetMenu label={label} value={key} onChange={select}
    placeholder={value?.kind === 'node' ? '不支持节点出口，请重新选择' : '选择策略组或内置策略'} options={[
      ...(missing ? [{ value: key, label: `已不存在：${value.groupId}` }] : []),
      ...groups.map(group => ({ value: `group:${group.id}`, label: group.name || '未命名组', group: '策略组' })),
      ...BUILTINS.map(name => ({ value: `builtin:${name}`, label: name, group: '内置策略' })),
    ]} />;
  return <Select placeholder="添加成员" aria-label={label} value={key} className={buttonClass('default', 'sm', 'self-start')} style={{ width: 'auto' }} onChange={event => select(event.target.value)}>
    {missing && <option value={key}>已不存在：{value.groupId}</option>}
    <optgroup label="模板组">{groups.map((g) => <option key={g.id} value={`group:${g.id}`}>{g.name || '未命名组'}</option>)}</optgroup>
    <optgroup label="内置策略">{BUILTINS.map((name) => <option key={name} value={`builtin:${name}`}>{name}</option>)}</optgroup>
  </Select>;
}

export function ItemIssues({ report, where }: { report: ReportItem[]; where: string }) {
  const issues = report.filter((r) => r.where === where);
  return issues.length > 0 ? <div className="rounded-lg border border-line px-3"><ReportList items={issues} showWhere={false} /></div> : null;
}

export function TemplateReport({ items, onLocate }: { items: ReportItem[]; onLocate: (where: string) => void }) {
  return <ReportList items={items} showWhere={false} onLocate={onLocate} canLocate={(where) => /^(group|rule):/.test(where)} />;
}
