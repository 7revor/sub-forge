import type { Builtin, Matcher, ReportItem, Target } from '@sub-forge/core';
import { BUILTINS } from '../../components/pickers.tsx';
import { ruleToLine } from '../../components/rule.ts';
import { Badge, ReportList, Select } from '../../components/ui.tsx';
import type { ConvertCtx, NamedRef } from '../../convert/templateYaml.ts';

export function matcherLabel(matcher: Matcher, ctx: ConvertCtx): string {
  if (matcher.kind === 'rule') return ruleToLine(matcher.rule);
  return `${matcher.kind === 'ruleset' ? '规则集' : '规则包'} · ${(matcher.kind === 'ruleset' ? ctx.rulesets : ctx.bundles).find((r) => r.id === matcher.id)?.name ?? (matcher.id || '未选择')}`;
}

export function TemplateTargetSelect({ value, onChange, groups, label }: {
  value: Target | undefined; onChange: (value: Extract<Target, { kind: 'group' | 'builtin' }>) => void; groups: NamedRef[]; label: string;
}) {
  const key = value?.kind === 'group' ? `group:${value.groupId}` : value?.kind === 'builtin' ? `builtin:${value.name}` : '';
  const missing = value?.kind === 'group' && !groups.some((g) => g.id === value.groupId);
  return <Select aria-label={label} value={key} onChange={(e) => {
    const key = e.target.value;
    if (key.startsWith('group:')) onChange({ kind: 'group', groupId: key.slice(6) });
    else if (key.startsWith('builtin:')) onChange({ kind: 'builtin', name: key.slice(8) as Builtin });
  }}>
    <option value="" disabled>{value?.kind === 'node' ? '不支持节点出口，请重新选择' : '请选择'}</option>
    {missing && <option value={key}>已不存在：{value.groupId}</option>}
    <optgroup label="模板组">{groups.map((g) => <option key={g.id} value={`group:${g.id}`}>{g.name || '未命名组'}</option>)}</optgroup>
    <optgroup label="内置策略">{BUILTINS.map((name) => <option key={name} value={`builtin:${name}`}>{name}</option>)}</optgroup>
  </Select>;
}

export function ItemIssues({ report, where }: { report: ReportItem[]; where: string }) {
  const issues = report.filter((r) => r.where === where);
  return issues.length > 0 ? <div className="rounded-lg border border-line px-3"><ReportList items={issues} /></div> : null;
}

export function TemplateReport({ items, onLocate }: { items: ReportItem[]; onLocate: (where: string) => void }) {
  if (!items.length) return <ReportList items={items} />;
  const tones = { error: 'err', warn: 'warn', info: 'accent' } as const;
  const levels = { error: '错误', warn: '告警', info: '提示' };
  return <div>{items.map((item, i) => item.where && /^(group|rule):/.test(item.where)
    ? <button key={i} type="button" className="flex w-full cursor-pointer flex-col gap-1 border-b border-line-2 py-2.5 text-left hover:bg-ground" onClick={() => onLocate(item.where!)}>
      <span className="flex items-center gap-2"><Badge tone={tones[item.level]}>{levels[item.level]}</Badge><span className="font-mono text-[11.5px] text-muted">{item.code}</span></span>
      <span className="text-[13px] leading-relaxed">{item.message}</span>
      <span className="text-[11.5px] text-accent">定位：{item.where}</span>
    </button> : <ReportList key={i} items={[item]} />)}</div>;
}
