import type { Matcher, ReportItem, RuleEntry, RuleIR } from '@sub-forge/core';
import { MatcherEditor } from '../../components/MatcherEditor.tsx';
import { SortableList } from '../../components/SortableList.tsx';
import { Button, Empty, Switch, buttonClass, cx } from '../../components/ui.tsx';
import { RuleSetPicker } from '../../components/RuleSetPicker.tsx';
import { newId, type ConvertCtx, type TemplateBody } from '../../convert/templateYaml.ts';
import { ItemIssues, matcherLabel, TemplateTargetSelect } from './TemplateFields.tsx';

const columns = 'grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[44px_minmax(0,2fr)_minmax(0,1fr)_116px_48px_48px]';

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
  return <div className="flex flex-col gap-3 border-t border-line bg-ground p-4">
    <ItemIssues report={report} where={`rule:${rule.id}`} />
    <MatcherEditor fixedKind value={matcher} rulesets={refs} ruleValue={ir} onRuleChange={changeRule} onChange={(matcher) => onChange({ ...rule, matcher })} />
  </div>;
}

export function TemplateRulesEditor({ value, onChange, selected, onSelect, ctx, report }: {
  value: TemplateBody; onChange: (value: TemplateBody) => void; selected: string | undefined; onSelect: (id: string | undefined) => void; ctx: ConvertCtx; report: ReportItem[];
}) {
  const update = (rule: RuleEntry) => onChange({ ...value, rules: value.rules.map((r) => r.id === rule.id ? rule : r) });
  const add = (matcher: Matcher) => {
    const id = newId('r');
    onChange({ ...value, rules: [...value.rules, { id, matcher, target: { kind: 'builtin', name: 'REJECT' } }] });
    onSelect(matcher.kind === 'rule' ? id : undefined);
  };
  return <section className="-mx-4">
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 className="m-0 text-[15px] font-semibold">规则（{value.rules.length} 条）</h2>
        <span className="text-[12.5px] text-muted">出口只能是模板组或内置策略。</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => add({ kind: 'rule', rule: { type: 'DOMAIN', value: '' } })}>添加单条规则</Button>
        <RuleSetPicker onSelect={add} triggerClassName={buttonClass()} />
      </div>
    </div>
    <div className="overflow-x-auto px-4 pb-4">
      {!value.rules.length && <Empty className="mb-4" title="没有规则" />}
      <div className="min-w-0">
        <div className={`${columns} hidden border-b border-line px-2 py-2 sm:grid text-[12px] text-muted`}><span>序号</span><span>匹配项</span><span>出口</span><span>no-resolve</span><span>启用</span><span>操作</span></div>
        <SortableList items={value.rules} getKey={(r) => r.id} onReorder={(rules) => onChange({ ...value, rules })} renderItem={(rule, i, handle) => {
          const error = report.some((r) => r.level === 'error' && r.where === `rule:${rule.id}`);
          return <div id={`template-rule-${rule.id}`} className={cx('my-1 overflow-hidden rounded-lg border', error ? 'border-err bg-err-soft' : 'border-line bg-panel')}>
            <div className={cx(columns, 'p-2 text-[13px]', rule.matcher.kind === 'rule' && 'cursor-pointer')} onClick={() => { if (rule.matcher.kind === 'rule') onSelect(selected === rule.id ? undefined : rule.id); }}>
              <span className="flex items-center" onClick={(e) => e.stopPropagation()}>{handle}{i + 1}</span>
              {rule.matcher.kind === 'ruleset' ? <div className="min-w-0">
                <RuleSetPicker label={matcherLabel(rule.matcher, ctx)} ariaLabel={`更换第 ${i + 1} 条规则集`} onSelect={(matcher) => update({ ...rule, matcher })} />
              </div> : <button type="button" aria-expanded={selected === rule.id} className={cx('min-w-0 cursor-pointer break-all text-left font-mono', error && 'text-err')}>{matcherLabel(rule.matcher, ctx)}</button>}
              <div className="col-start-2 row-start-2 min-w-0 sm:col-auto sm:row-auto" onClick={(e) => e.stopPropagation()}><TemplateTargetSelect label={`第 ${i + 1} 条规则出口`} value={rule.target} groups={value.groups} onChange={(target) => update({ ...rule, target })} /></div>
              <div className={cx('col-start-2 row-start-3 sm:col-auto sm:row-auto', rule.matcher.kind !== 'ruleset' && 'hidden sm:block')} onClick={(e) => e.stopPropagation()}>
                {rule.matcher.kind === 'ruleset' ? <label className="flex cursor-pointer items-center gap-2">
                  <Switch label={`第 ${i + 1} 条规则 no-resolve`} checked={rule.options?.noResolve ?? false} onChange={(noResolve) => update({ ...rule, options: { ...rule.options, noResolve } })} />
                  <span className="text-[12px] sm:hidden">no-resolve</span>
                </label> : <span className="text-muted">—</span>}
              </div>
              <div className="col-start-3 row-start-1 sm:col-auto sm:row-auto" onClick={(e) => e.stopPropagation()}><Switch label={`启用第 ${i + 1} 条规则`} checked={rule.enabled !== false} onChange={(enabled) => update({ ...rule, enabled })} /></div>
              <Button size="sm" className="col-start-3 row-start-2 sm:col-auto sm:row-auto" onClick={(e) => { e.stopPropagation(); onChange({ ...value, rules: value.rules.filter((r) => r.id !== rule.id) }); }}>删除</Button>
            </div>
            {rule.matcher.kind === 'rule' && selected === rule.id && <RuleFields rule={rule} onChange={update} ctx={ctx} report={report} />}
            {rule.matcher.kind === 'ruleset' && <ItemIssues report={report} where={`rule:${rule.id}`} />}
          </div>;
        }} />
        <div className="mt-3 grid grid-cols-1 items-center gap-3 px-2 py-3 text-[13px] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"><span className="font-mono">MATCH（固定）</span><TemplateTargetSelect label="MATCH 出口" value={value.final} groups={value.groups} onChange={(final) => onChange({ ...value, final })} /></div>
        <ItemIssues report={report} where="final" />
      </div>
    </div>
  </section>;
}
