import type { Builtin, ReportItem, Target } from '@sub-forge/core';
import { Plus } from 'lucide-react';
import { BUILTINS } from '../../components/pickers.tsx';
import { buttonClass, ReportList, Select } from '../../components/ui.tsx';
import type { NamedRef } from '../../convert/templateYaml.ts';

export function TemplateTargetSelect({ value, onChange, groups, label, action = false }: {
  value: Target | undefined; onChange: (value: Extract<Target, { kind: 'group' | 'builtin' }>) => void; groups: NamedRef[]; label: string; action?: boolean;
}) {
  const key = value?.kind === 'group' ? `group:${value.groupId}` : value?.kind === 'builtin' ? `builtin:${value.name}` : '';
  const missing = value?.kind === 'group' && !groups.some((g) => g.id === value.groupId);
  return <Select aria-label={label} value={key} className={action ? buttonClass('default', 'sm', 'self-start') : undefined} style={action ? { width: 'auto' } : undefined} onChange={(e) => {
    const key = e.target.value;
    if (key.startsWith('group:')) onChange({ kind: 'group', groupId: key.slice(6) });
    else if (key.startsWith('builtin:')) onChange({ kind: 'builtin', name: key.slice(8) as Builtin });
  }}>
    <option value="" disabled>{action ? <span className="flex items-center justify-center gap-2"><Plus size={14} className="shrink-0" />添加成员</span> : value?.kind === 'node' ? '不支持节点出口，请重新选择' : '请选择'}</option>
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
