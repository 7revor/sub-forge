import { useQuery } from '@tanstack/react-query';
import type { GroupMember, GroupSpec, RuleEntry, Target } from '@sub-forge/core';
import { stringify } from 'yaml';
import { api } from '../../api.ts';
import { memberLabel, targetLabel } from '../../components/pickers.tsx';
import { Badge, ErrorAlert, Modal } from '../../components/ui.tsx';
import { templateDiff, type EntityDiff, type FieldChange } from '../../convert/templateDiff.ts';
import type { ConvertCtx, TemplateBody } from '../../convert/templateYaml.ts';
import type { TemplateDoc } from '../../hooks.ts';
import { matcherLabel } from './TemplateFields.tsx';

function displayField(field: string, value: unknown, body: TemplateBody, ctx: ConvertCtx): string {
  const groupName = (id: string) => body.groups.find((g) => g.id === id)?.name ?? id;
  if (value === undefined) return '未设置';
  if (field === 'members') return (value as GroupMember[]).map((m) => memberLabel(m, groupName, (r) => r.id).text).join('、') || '无成员';
  if (field.endsWith('groupId')) return groupName(String(value));
  if (field === 'target') return targetLabel(value as Target, groupName, (r) => r.id);
  if (field === 'matcher') return matcherLabel(value as RuleEntry['matcher'], ctx);
  if (field === 'matcher.id') return ctx.rulesets.find((r) => r.id === value)?.name ?? String(value);
  return typeof value === 'string' ? value : stringify(value).trim();
}

function Changes<T extends GroupSpec | RuleEntry>({ label, diff, before, after, nameOf, ctx }: {
  label: string; diff: EntityDiff<T>; before: TemplateBody; after: TemplateBody; nameOf: (item: T) => string; ctx: ConvertCtx;
}) {
  const renderFields = (fields: FieldChange[]) => <ul className="m-0 flex list-none flex-col gap-1 p-0">{fields.map((f) => <li key={f.field} className="break-all text-[12.5px]">
    <span className="font-mono font-medium">{f.field}</span>：<span className="whitespace-pre-wrap">{displayField(f.field, f.before, before, ctx)}</span> → <span className="whitespace-pre-wrap">{displayField(f.field, f.after, after, ctx)}</span>
  </li>)}</ul>;
  const all = label === '组' ? after.groups : after.rules;
  return <section className="flex flex-col gap-2"><h3 className="m-0 text-[14px] font-semibold">{label}</h3>
    {!diff.added.length && !diff.removed.length && !diff.modified.length && !diff.moved.length && <span className="text-[13px] text-muted">无变化</span>}
    {diff.added.map((item) => <div key={`add:${item.id}`} className="text-[13px]"><Badge tone="ok">新增</Badge> {nameOf(item)}{'members' in item && <span> · 成员：{displayField('members', item.members, after, ctx)}</span>}</div>)}
    {diff.removed.map((item) => <div key={`remove:${item.id}`} className="text-[13px]"><Badge tone="err">删除</Badge> {nameOf(item)}{'members' in item && <span> · 成员：{displayField('members', item.members, before, ctx)}</span>}</div>)}
    {diff.modified.map((item) => <div key={`modify:${item.id}`} className="rounded-lg border border-line p-2"><div className="mb-1 text-[13px]"><Badge tone="warn">修改</Badge> {nameOf(item.after)}</div>{renderFields(item.fields)}</div>)}
    {diff.moved.map((item) => <div key={`move:${item.id}`} className="text-[13px]"><Badge tone="accent">移动</Badge> {nameOf(all.find((entry) => entry.id === item.id) as T)}：第 {item.before + 1} 项 → 第 {item.after + 1} 项</div>)}
  </section>;
}

export function TemplateDiff({ id, version, ctx, onClose }: { id: string; version: number; ctx: ConvertCtx; onClose: () => void }) {
  const versions = useQuery({ queryKey: ['template-diff', id, version], queryFn: async () => {
    const [before, after] = await Promise.all([version - 1, version].map((v) => api<{ item: TemplateDoc }>('GET', `/templates/${id}/versions/${v}`)));
    return { before: before!.item, after: after!.item };
  } });
  const data = versions.data;
  const diff = data && templateDiff(data.before, data.after);
  const target = (value: Target, body: TemplateBody) => targetLabel(value, (id) => body.groups.find((g) => g.id === id)?.name ?? id, (r) => r.id);
  return <Modal title={`版本对比：v${version - 1} → v${version}`} open onClose={onClose} wide>
    <ErrorAlert error={versions.error} />
    {!data && !versions.error && <span className="text-muted">加载中…</span>}
    {data && diff && <>
      <Changes label="组" diff={diff.groups} before={data.before} after={data.after} nameOf={(g) => g.name} ctx={ctx} />
      <Changes label="规则" diff={diff.rules} before={data.before} after={data.after} nameOf={(r) => matcherLabel(r.matcher, ctx)} ctx={ctx} />
      <div className="text-[13px]">MATCH / final：{diff.final ? `${target(diff.final.before, data.before)} → ${target(diff.final.after, data.after)}` : '无变化'}</div>
      {diff.ruleProviders && <div className="text-[13px]">远程规则来源（按顺序）：<pre className="whitespace-pre-wrap break-all">{stringify(diff.ruleProviders.before ?? [])}→{'\n'}{stringify(diff.ruleProviders.after ?? [])}</pre></div>}
    </>}
  </Modal>;
}
