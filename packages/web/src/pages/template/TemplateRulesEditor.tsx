import type { Matcher, ReportItem, RuleEntry, RuleIR } from '@sub-forge/core';
import { RuleEditor } from '../../components/RuleEditor.tsx';
import { SortableList } from '../../components/SortableList.tsx';
import { Button, Card, Field, Select, Switch, cx } from '../../components/ui.tsx';
import { newId, type ConvertCtx, type TemplateBody } from '../../convert/templateYaml.ts';
import { ItemIssues, matcherLabel, TemplateTargetSelect } from './TemplateFields.tsx';

const columns = 'grid grid-cols-[58px_minmax(130px,2fr)_minmax(130px,1fr)_60px_56px] items-center gap-2';

function RuleFields({ rule, onChange, ctx, value, report }: {
  rule: RuleEntry; onChange: (rule: RuleEntry) => void; ctx: ConvertCtx; value: TemplateBody; report: ReportItem[];
}) {
  const matcher = rule.matcher;
  const refs = matcher.kind === 'ruleset' ? ctx.rulesets : ctx.bundles;
  const changeRule = (next: RuleIR) => {
    if (matcher.kind !== 'rule') return;
    const ip = 'noResolve' in next || ['IP-CIDR', 'IP-CIDR6', 'IP-ASN', 'GEOIP', 'SRC-IP-CIDR'].includes(next.type);
    onChange({ ...rule, matcher: { ...matcher, rule: next }, ...(ip && rule.options?.noResolve !== undefined ? { options: { ...rule.options, noResolve: false } } : {}) });
  };
  // 历史数据可能把 IP 规则的 no-resolve 放在 options 中，统一交给 RuleEditor 编辑。
  const ir = matcher.kind === 'rule' && rule.options?.noResolve && ['IP-CIDR', 'IP-CIDR6', 'IP-ASN', 'GEOIP', 'SRC-IP-CIDR'].includes(matcher.rule.type)
    ? { ...matcher.rule, noResolve: true } : matcher.kind === 'rule' ? matcher.rule : undefined;
  return <div className="flex flex-col gap-3 border-t border-line p-3">
    <ItemIssues report={report} where={`rule:${rule.id}`} />
    <Field label="匹配项类型">{(id) => <Select id={id} value={matcher.kind} onChange={(e) => {
      const kind = e.target.value as Matcher['kind'];
      onChange({ ...rule, matcher: kind === 'rule' ? { kind, rule: { type: 'DOMAIN', value: '' } } : { kind, id: '' } });
    }}><option value="rule">单条规则</option><option value="ruleset">规则集</option><option value="bundle">规则包</option></Select>}</Field>
    {matcher.kind === 'rule' ? <RuleEditor value={ir} onChange={changeRule} onIncomplete={changeRule} /> : <>
      <Field label={matcher.kind === 'ruleset' ? '规则集' : '规则包'}>{(id) => <Select id={id} value={matcher.id} onChange={(e) => onChange({ ...rule, matcher: { ...matcher, id: e.target.value } })}>
        <option value="">请选择</option>
        {matcher.id && !refs.some((ref) => ref.id === matcher.id) && <option value={matcher.id}>已不存在：{matcher.id}</option>}
        {refs.map((ref) => <option key={ref.id} value={ref.id}>{ref.name}</option>)}
      </Select>}</Field>
      <div className="flex items-center gap-2"><Switch label="no-resolve" checked={rule.options?.noResolve ?? false} onChange={(noResolve) => onChange({ ...rule, options: { ...rule.options, noResolve } })} /><span className="text-[13px]">no-resolve</span></div>
    </>}
    <Field label="出口">{() => <TemplateTargetSelect label="规则出口" value={rule.target} groups={value.groups} onChange={(target) => onChange({ ...rule, target })} />}</Field>
  </div>;
}

export function TemplateRulesEditor({ value, onChange, selected, onSelect, ctx, report }: {
  value: TemplateBody; onChange: (value: TemplateBody) => void; selected: string | undefined; onSelect: (id: string | undefined) => void; ctx: ConvertCtx; report: ReportItem[];
}) {
  const update = (rule: RuleEntry) => onChange({ ...value, rules: value.rules.map((r) => r.id === rule.id ? rule : r) });
  return <Card title="规则" bodyClass="overflow-x-auto px-4 pb-4">
    <div className="min-w-[580px]">
      <div className={`${columns} border-b border-line px-2 py-2 text-[12px] text-muted`}><span>序号</span><span>匹配项</span><span>出口</span><span>启用</span><span>操作</span></div>
      <SortableList items={value.rules} getKey={(r) => r.id} onReorder={(rules) => onChange({ ...value, rules })} renderItem={(rule, i, handle) => {
        const error = report.some((r) => r.level === 'error' && r.where === `rule:${rule.id}`);
        return <div id={`template-rule-${rule.id}`} className={cx('my-1 rounded-lg border', error ? 'border-err bg-err-soft' : 'border-line')}>
          <div className={`${columns} cursor-pointer p-2 text-[13px]`} onClick={() => onSelect(selected === rule.id ? undefined : rule.id)}>
            <span className="flex items-center" onClick={(e) => e.stopPropagation()}>{handle}{i + 1}</span>
            <button type="button" aria-expanded={selected === rule.id} className={cx('cursor-pointer break-all text-left font-mono', error && 'text-err')}>{matcherLabel(rule.matcher, ctx)}</button>
            <div onClick={(e) => e.stopPropagation()}><TemplateTargetSelect label={`第 ${i + 1} 条规则出口`} value={rule.target} groups={value.groups} onChange={(target) => update({ ...rule, target })} /></div>
            <div onClick={(e) => e.stopPropagation()}><Switch label={`启用第 ${i + 1} 条规则`} checked={rule.enabled !== false} onChange={(enabled) => update({ ...rule, enabled })} /></div>
            <Button size="sm" onClick={(e) => { e.stopPropagation(); onChange({ ...value, rules: value.rules.filter((r) => r.id !== rule.id) }); }}>删除</Button>
          </div>
          {selected === rule.id && <RuleFields rule={rule} onChange={update} ctx={ctx} value={value} report={report} />}
        </div>;
      }} />
      <div className={`${columns} border-t border-line px-2 py-3 text-[13px]`}><span>—</span><span className="font-mono">MATCH（固定）</span><TemplateTargetSelect label="MATCH 出口" value={value.final} groups={value.groups} onChange={(final) => onChange({ ...value, final })} /><span /><span /></div>
      <ItemIssues report={report} where="final" />
    </div>
    <Button onClick={() => {
      const id = newId('r');
      onChange({ ...value, rules: [...value.rules, { id, matcher: { kind: 'rule', rule: { type: 'DOMAIN', value: '' } }, target: { kind: 'builtin', name: 'REJECT' } }] });
      onSelect(id);
    }}>新增规则</Button>
  </Card>;
}
