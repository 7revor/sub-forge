import type { Matcher, ReportItem, RuleEntry, RuleIR } from '@sub-forge/core';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect } from 'react';
import { MatcherEditor } from '../../components/MatcherEditor.tsx';
import { SortableList } from '../../components/SortableList.tsx';
import { Button, Empty, Switch, buttonClass, cx } from '../../components/ui.tsx';
import { RemoteRulePicker } from '../../components/RemoteRulePicker.tsx';
import { RuleSetPicker } from '../../components/RuleSetPicker.tsx';
import { newId, type ConvertCtx, type TemplateBody } from '../../convert/templateYaml.ts';
import { ItemIssues, matcherLabel, TemplateTargetSelect } from './TemplateFields.tsx';

const columns = 'grid grid-cols-[36px_minmax(0,1fr)] gap-x-3 sm:grid-cols-[44px_minmax(0,1fr)_172px_88px] sm:gap-x-5';
const editClass = 'inline-flex min-h-8 shrink-0 cursor-pointer items-center rounded px-1 text-[12px] font-medium text-accent-ink hover:bg-accent-soft';

function summary(matcher: Matcher, ctx: ConvertCtx) {
  if (matcher.kind === 'rule') return { title: matcherLabel(matcher, ctx), kind: '单条规则', detail: undefined };
  if (matcher.remote) {
    const url = matcher.remote.url;
    const path = URL.canParse(url) ? new URL(url).pathname : '';
    return { title: path.split('/').filter(Boolean).at(-1) || '远程规则', kind: '远程 URL', detail: url || '尚未填写地址' };
  }
  return { title: matcher.repository?.name ?? ctx.rulesets.find(r => r.id === matcher.id)?.name ?? '规则集不可用',
    kind: matcher.repository ? '规则仓库' : '规则增强', detail: undefined };
}

function RuleFields({ rule, onChange, ctx, report }: {
  rule: RuleEntry; onChange: (rule: RuleEntry) => void; ctx: ConvertCtx; report: ReportItem[];
}) {
  const matcher = rule.matcher;
  const refs = ctx.rulesets;
  const changeRule = (next: RuleIR) => {
    if (matcher.kind !== 'rule') return;
    const ip = 'noResolve' in next || ['IP-CIDR', 'IP-CIDR6', 'IP-ASN', 'GEOIP', 'SRC-IP-CIDR'].includes(next.type);
    onChange({ ...rule, matcher: { ...matcher, rule: next }, ...(ip && rule.options?.noResolve !== undefined ? { options: { ...rule.options, noResolve: false } } : {}) });
  };
  // 历史数据可能把 IP 规则的 no-resolve 放在 options 中，统一交给 RuleEditor 编辑。
  const ir = matcher.kind === 'rule' && rule.options?.noResolve && ['IP-CIDR', 'IP-CIDR6', 'IP-ASN', 'GEOIP', 'SRC-IP-CIDR'].includes(matcher.rule.type)
    ? { ...matcher.rule, noResolve: true } : matcher.kind === 'rule' ? matcher.rule : undefined;
  return <div className="flex flex-col gap-3">
    <ItemIssues report={report} where={`rule:${rule.id}`} />
    <MatcherEditor fixedKind value={matcher} rulesets={refs} ruleValue={ir} onRuleChange={changeRule} onChange={(matcher) => onChange({ ...rule, matcher })} />
  </div>;
}

export function TemplateRulesEditor({ value, onChange, selected, onSelect, ctx, report }: {
  value: TemplateBody; onChange: (value: TemplateBody) => void; selected: string | undefined; onSelect: (id: string | undefined) => void; ctx: ConvertCtx; report: ReportItem[];
}) {
  useEffect(() => {
    if (!selected) return;
    const frame = requestAnimationFrame(() => document.getElementById(`template-rule-${selected}`)?.scrollIntoView({ block: 'nearest' }));
    return () => cancelAnimationFrame(frame);
  }, [selected]);
  const update = (rule: RuleEntry) => onChange({ ...value, rules: value.rules.map((r) => r.id === rule.id ? rule : r) });
  const add = (matcher: Matcher) => {
    const id = newId('r');
    onChange({ ...value, rules: [...value.rules, { id, matcher, target: { kind: 'builtin', name: 'REJECT' } }] });
    onSelect(matcher.kind === 'rule' ? id : undefined);
  };
  return <section className="pt-3 pb-5" aria-label="分流规则">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="m-0 flex items-baseline gap-2 text-[15px] font-semibold">规则<span className="text-[12px] font-normal text-muted">{value.rules.length} 条</span></h2>
        <span className="text-[12px] text-muted">自上而下匹配，拖动调整顺序。</span>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="添加规则">
        <Button size="sm" aria-label="添加单条规则" onClick={() => add({ kind: 'rule', rule: { type: 'DOMAIN', value: '' } })}><Plus size={14} aria-hidden />单条规则</Button>
        <RemoteRulePicker label="远程 URL" ariaLabel="引用远程 URL" triggerClassName={buttonClass('default', 'sm')} onSelect={add} />
        <RuleSetPicker label="系统规则集" ariaLabel="引用系统规则集" onSelect={add} triggerClassName={buttonClass('default', 'sm')} />
      </div>
    </div>
    <div className="min-w-0">
      {!value.rules.length && <Empty className="py-6" title="没有规则" />}
      {!!value.rules.length && <div className={`${columns} hidden border-b border-line pb-2 sm:grid text-[12px] text-muted`}><span>顺序</span><span>匹配规则</span><span>出口</span><span>启用</span></div>}
        <SortableList items={value.rules} getKey={(r) => r.id} onReorder={(rules) => onChange({ ...value, rules })} renderItem={(rule, i, handle) => {
          const error = report.some((r) => r.level === 'error' && r.where === `rule:${rule.id}`);
          const text = summary(rule.matcher, ctx);
          const expanded = rule.matcher.kind === 'rule' && selected === rule.id;
          return <div id={`template-rule-${rule.id}`} className={cx('py-4', i > 0 && 'border-t border-line-2', error ? 'bg-err-soft' : 'bg-panel')}>
            <div className={cx(columns, 'items-start gap-y-3 text-[13px]')}>
              <span className="flex h-9 items-center text-[12px] tabular-nums text-muted">{handle}{i + 1}</span>
              <div className="min-w-0">
                <div className="flex min-h-9 items-center gap-2">
                  {rule.matcher.kind === 'rule' ? <button type="button" aria-expanded={expanded} onClick={() => onSelect(expanded ? undefined : rule.id)}
                    className={cx('min-w-0 cursor-pointer rounded text-left font-medium break-all hover:text-accent-ink', rule.enabled === false ? 'text-muted' : 'text-ink', error && 'text-err')}>{text.title}</button>
                    : <span className={cx('min-w-0 truncate font-medium', rule.enabled === false ? 'text-muted' : 'text-ink')} title={text.title}>{text.title}</span>}
                  {rule.matcher.kind === 'ruleset' ? rule.matcher.remote
                    ? <RemoteRulePicker value={rule.matcher.remote.url} label="编辑" ariaLabel={`编辑第 ${i + 1} 条远程规则`} triggerClassName={editClass} onSelect={matcher => update({ ...rule, matcher })} />
                    : <RuleSetPicker label="更换" ariaLabel={`更换第 ${i + 1} 条规则集`} triggerClassName={editClass} onSelect={matcher => update({ ...rule, matcher })} />
                    : <button type="button" className={editClass} aria-label={`${expanded ? '收起' : '编辑'}第 ${i + 1} 条规则`} aria-expanded={expanded} onClick={() => onSelect(expanded ? undefined : rule.id)}>{expanded ? '收起' : '编辑'}</button>}
                </div>
                <div className="flex min-w-0 items-center gap-2 text-[12px] leading-5 text-muted">
                  <span className="shrink-0">{text.kind}</span>
                  {text.detail && <span className="truncate" title={text.detail}>{text.detail}</span>}
                </div>
              </div>
              <div className="col-start-2 flex min-w-0 items-start gap-4 sm:col-auto sm:contents">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="text-[12px] text-muted sm:hidden">出口</span>
                  <TemplateTargetSelect label={`第 ${i + 1} 条规则出口`} value={rule.target} groups={value.groups} onChange={(target) => update({ ...rule, target })} />
                  {rule.matcher.kind === 'ruleset' && <label className="flex min-h-6 cursor-pointer items-center gap-2 text-[12px] text-muted" title="IP 规则不通过 DNS 解析域名">
                    <input type="checkbox" className="h-3.5 w-3.5 accent-accent" aria-label={`第 ${i + 1} 条规则 no-resolve`} checked={rule.options?.noResolve ?? false} onChange={event => update({ ...rule, options: { ...rule.options, noResolve: event.target.checked } })} />no-resolve
                  </label>}
                </div>
                <div className="flex shrink-0 flex-col gap-1.5">
                  <span className="text-[12px] text-muted sm:hidden">启用</span>
                  <div className="flex h-[38px] items-center gap-3">
                    <Switch label={`启用第 ${i + 1} 条规则`} checked={rule.enabled !== false} onChange={(enabled) => update({ ...rule, enabled })} />
                    <button type="button" title={`删除第 ${i + 1} 条规则`} aria-label={`删除第 ${i + 1} 条规则`} className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted hover:bg-err-soft hover:text-err" onClick={() => { onChange({ ...value, rules: value.rules.filter((r) => r.id !== rule.id) }); if (selected === rule.id) onSelect(undefined); }}><Trash2 size={16} aria-hidden /></button>
                  </div>
                </div>
              </div>
            </div>
            {expanded && <div className="mt-3 rounded-lg bg-ground p-4 sm:ml-16">
              <div className="mb-3 flex items-center justify-between gap-3"><span className="text-[12px] font-medium text-muted">编辑第 {i + 1} 条规则</span><button type="button" className={editClass} onClick={() => onSelect(undefined)}>完成</button></div>
              <RuleFields rule={rule} onChange={update} ctx={ctx} report={report} />
            </div>}
            {!expanded && <ItemIssues report={report} where={`rule:${rule.id}`} />}
          </div>;
        }} />
        <div className={cx(columns, 'mt-3 items-center gap-y-3 rounded-lg bg-ground px-3 py-4 sm:px-0')}>
          <div className="col-span-2 flex min-w-0 flex-col gap-1 sm:col-span-1 sm:col-start-2"><span className="text-[13px] font-medium">兜底出口 <span className="ml-2 font-mono text-[12px] font-normal text-muted">MATCH</span></span><span className="text-[12px] text-muted">以上规则均未匹配时使用</span></div>
          <div className="col-span-2 min-w-0 sm:col-span-1"><TemplateTargetSelect label="MATCH 出口" value={value.final} groups={value.groups} onChange={(final) => onChange({ ...value, final })} /></div>
        </div>
        <ItemIssues report={report} where="final" />
    </div>
  </section>;
}
