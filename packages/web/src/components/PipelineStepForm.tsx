import { DEFAULT_USELESS_PATTERNS, type OperatorStep } from '@sub-forge/core';
import { Plus, Trash2 } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { alertError } from '../feedback.ts';
import { proxyPlaceholders } from '../schemas/placeholders.ts';
import { ExtraFields } from './ExtraFields.tsx';
import { OptionalBoolean } from './OptionalBoolean.tsx';
import { RoutingCard } from './RoutingCard.tsx';
import { SortableList } from './SortableList.tsx';
import { patternHits, regexError, renameHits, setFieldsError, updateSetField } from './pipelineForm.ts';
import { Button, DraftInput, DraftTextarea, Empty, Input, Select, cx } from './ui.tsx';

const lbl = 'text-[12.5px] font-medium text-ink-muted';
const hint = 'text-[12px] leading-relaxed text-ink-muted';

function DeleteIcon({ label, onClick }: { label: string; onClick: () => void }) {
  return <Button variant="ghost" size="sm" className="shrink-0 px-1.5 hover:text-err" aria-label={label} title={label} onClick={onClick}><Trash2 size={14} /></Button>;
}

function FormHeader({ title, action }: { title: string; action?: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-2">
    <h3 className="m-0 text-[13px] font-medium text-ink-2">{title}</h3>
    {action}
  </div>;
}

function AddButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <Button size="sm" onClick={onClick}><Plus size={14} />{children}</Button>;
}

function HitCount({ value }: { value?: number | undefined }) {
  return <span className="shrink-0 text-[12px] text-ink-muted">命中 <span className="font-mono text-ink-2">{value ?? '—'}</span></span>;
}

/** 简单选择使用带标签的单选项，不增加底色或套叠面板。 */
function ChoiceField<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void;
}) {
  const name = useId();
  return <fieldset className="m-0 min-w-0 border-0 p-0">
    <legend className="mb-2 text-[12.5px] font-medium text-ink-muted">{label}</legend>
    <div className="flex flex-wrap gap-x-6 gap-y-2">
      {options.map(option => <label key={option.value} className="flex min-h-8 cursor-pointer items-center gap-2 text-[13px] text-ink-2">
        <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} className="accent-brand" />
        {option.label}
      </label>)}
    </div>
  </fieldset>;
}

/** 重复参数使用规则集同款卡片；添加动作固定在列表之前。 */
function PatternRows({ label, patterns, hits, onChange, addLabel = '添加正则', flags = '', placeholder = '按节点名称匹配的正则表达式' }: {
  label: string; patterns: string[]; hits?: (number | undefined)[]; onChange: (patterns: string[]) => void; addLabel?: string; flags?: string; placeholder?: string;
}) {
  return <div>
    <FormHeader title={label} action={<AddButton onClick={() => onChange([...patterns, ''])}>{addLabel}</AddButton>} />
    {patterns.map((pattern, index) => {
      const error = pattern ? regexError(pattern, flags) : '未填写，这一条不会生效';
      return <RoutingCard key={index} invalid={!!pattern && !!error} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[24px_minmax(0,1fr)_auto]">
        <span className="text-center font-mono text-[12px] text-ink-muted">{index + 1}</span>
        <DraftInput aria-label={`${label} ${index + 1}`} className={cx('col-span-2 row-start-2 h-9 min-w-0 font-mono sm:col-span-1 sm:col-start-2 sm:row-start-1', pattern && error && 'border-err')} placeholder={placeholder} value={pattern}
          aria-invalid={!!pattern && !!error} onCommit={(value) => onChange(patterns.map((item, i) => i === index ? value : item))} />
        <div className="col-start-2 row-start-1 flex items-center gap-2 sm:col-start-3">
          <HitCount value={hits?.[index]} />
          <DeleteIcon label={`删除第 ${index + 1} 条`} onClick={() => onChange(patterns.filter((_, i) => i !== index))} />
        </div>
        {error && <span role="status" className={cx('col-span-full text-[12px]', pattern ? 'text-err' : 'text-ink-muted')}>{error}</span>}
      </RoutingCard>;
    })}
    {!patterns.length && <div className="mt-3"><Empty title="尚未添加正则" /></div>}
  </div>;
}

const SET_BOOLS = ['udp', 'tfo', 'skip-cert-verify'] as const;
const SET_SELECTS = {
  'client-fingerprint': ['chrome', 'firefox', 'safari', 'ios', 'android', 'edge', '360', 'qq', 'random', 'randomized'],
  'ip-version': ['dual', 'ipv4', 'ipv6', 'ipv4-prefer', 'ipv6-prefer'],
};
const SET_KEYS = [...SET_BOOLS, ...Object.keys(SET_SELECTS)];
const PROTOCOLS = ['ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic', 'anytls', 'socks5', 'http', 'snell'];
const ROW = 'flex min-w-0 flex-col gap-1.5';

function SetFieldsForm({ fields, onChange }: { fields: Record<string, unknown>; onChange: (fields: Record<string, unknown>) => void }) {
  const [error, setError] = useState<string>();
  const extra = Object.fromEntries(Object.entries(fields).filter(([key]) => !SET_KEYS.includes(key)));
  // 字段名由公共编辑器显式校验，提交时再校验完整数据。
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
    {SET_BOOLS.map((key) => <div key={key} className={ROW}><span className={cx(lbl, 'font-mono')}>{key}</span><OptionalBoolean label={key} placeholder={proxyPlaceholders[key]} size="sm" value={typeof fields[key] === 'boolean' ? fields[key] as boolean : undefined}
      onChange={(v) => onChange(updateSetField(fields, key, v))} /></div>)}
    {Object.entries(SET_SELECTS).map(([key, options]) => {
      const value = fields[key] === undefined ? '' : String(fields[key]);
      return <div key={key} className={ROW}><span className={cx(lbl, 'font-mono')}>{key}</span><Select clearable placeholder={proxyPlaceholders[key as keyof typeof SET_SELECTS]} aria-label={key} className="h-9" value={value}
        onChange={(e) => onChange(updateSetField(fields, key, e.target.value || undefined))}>
        {value && !options.includes(value) && <option value={value}>{value}（当前值）</option>}
        {options.map((v) => <option key={v} value={v}>{v}</option>)}
      </Select></div>;
    })}
    <div className="flex min-w-0 flex-col gap-2 sm:col-span-2">
      <ExtraFields layout="cards" value={extra} validateName={(key) => setFieldsError({ [key]: null }) || (SET_KEYS.includes(key) ? '请使用上方控件修改该字段' : undefined)} onChange={(next) => {
        const error = setFieldsError(next) || (Object.keys(next).some((key) => SET_KEYS.includes(key)) ? '请使用上方控件修改该字段' : undefined);
        setError(error);
        if (error) return;
        onChange({ ...Object.fromEntries(Object.entries(fields).filter(([key]) => SET_KEYS.includes(key))), ...next });
      }} />
      {(error || setFieldsError(extra)) && <div role="alert" className="text-[12px] text-err">{error || setFieldsError(extra)}</div>}
    </div>
  </div>;
}

function TypeFilterForm({ step, onChange }: { step: Extract<OperatorStep, { op: 'filter.type' }>; onChange: (s: OperatorStep) => void }) {
  const [custom, setCustom] = useState('');
  return <div className="flex flex-col gap-2.5">
    <ChoiceField label="命中后" value={step.keep ? 'keep' : 'drop'} options={[{ value: 'drop', label: '剔除选中的协议' }, { value: 'keep', label: '只保留选中的协议' }]} onChange={(v) => onChange({ ...step, keep: v === 'keep' })} />
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex min-w-0 flex-1 flex-col gap-1.5"><span className={lbl}>其他协议</span><Input aria-label="其他协议" className="h-9 font-mono" placeholder="其他协议，如 wireguard" value={custom} onChange={(e) => setCustom(e.target.value)} /></label>
      <Button size="sm" className="h-9" onClick={() => {
        const type = custom.trim().toLowerCase();
        if (!type) { alertError('请输入协议类型'); return; }
        onChange({ ...step, types: [...new Set([...step.types, type])] }); setCustom('');
      }}><Plus size={14} />添加协议</Button>
    </div>
    <fieldset className="m-0 grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2 border-0 p-0">
      <legend className="mb-2 text-[12.5px] font-medium text-ink-muted">协议类型（至少选一个）</legend>
      {[...new Set([...PROTOCOLS, ...step.types])].map((type) => {
        const on = step.types.includes(type);
        return <label key={type} className={cx('flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-2.5 font-mono text-[13px]', on ? 'border-brand font-medium text-accent-ink' : 'border-line')}>
          <input type="checkbox" checked={on} onChange={(e) => {
            const types = e.target.checked ? [...step.types, type] : step.types.filter((v) => v !== type);
            if (!types.length) { alertError('至少选择一个协议类型'); return; }
            onChange({ ...step, types });
          }} />{type.toUpperCase()}
        </label>;
      })}
    </fieldset>

  </div>;
}

export function PipelineStepForm({ step, names, onChange }: { step: OperatorStep; names: string[] | undefined; onChange: (s: OperatorStep) => void }) {
  const hits = (patterns: string[]) => (names ? patternHits(patterns, names) : undefined);
  switch (step.op) {
    case 'filter.useless': {
      const value = step.patterns ?? [];
      return <div className="flex flex-col gap-2">
        <label htmlFor="useless" className={lbl}>关键词（正则，每行一条；命中任一条的节点被移除）</label>
        <DraftTextarea placeholder="移除命中关键词的节点，每行填写一条正则" id="useless" rows={4} className="font-mono text-[12.5px]" value={value.join('\n')}
          aria-invalid={value.some((p) => !!regexError(p))}
          onCommit={(text) => { const lines = text.split('\n').map((l) => l.trim()).filter(Boolean); onChange({ ...step, patterns: lines.length ? lines : undefined }); }} />
        {value.map((p, i) => ({ i, error: p.trim() ? regexError(p.trim()) : undefined })).filter((x) => x.error).map(({ i, error }) => <span key={i} role="status" className="text-[12px] text-err">第 {i + 1} 行：{error}</span>)}
        <span className={hint}>清空后使用默认关键词：{DEFAULT_USELESS_PATTERNS.slice(0, 8).join('、')}…</span>
      </div>;
    }
    case 'filter.regex':
      return <div className="flex flex-col gap-2.5">
        <ChoiceField label="命中后" value={step.keep ? 'keep' : 'drop'} options={[{ value: 'drop', label: '剔除命中' }, { value: 'keep', label: '只保留命中' }]} onChange={(v) => onChange({ ...step, keep: v === 'keep' })} />
        <PatternRows label="正则（命中任一条即算命中）" patterns={step.patterns} hits={hits(step.patterns)} onChange={(patterns) => onChange({ ...step, patterns })} />
      </div>;
    case 'filter.type':
      return <TypeFilterForm step={step} onChange={onChange} />;
    case 'rename.delete':
      return <div className="flex flex-col gap-2">
        <PatternRows label="要删除的部分（正则）" patterns={step.patterns} hits={hits(step.patterns)} flags="g" onChange={(patterns) => onChange({ ...step, patterns })} />
      </div>;
    case 'sort.regex':
      return <div>
        <FormHeader title="优先级（从上到下）" action={<AddButton onClick={() => onChange({ ...step, patterns: [...step.patterns, ''] })}>添加优先级</AddButton>} />
        <SortableList items={step.patterns} onReorder={(patterns) => onChange({ ...step, patterns })} renderItem={(pattern, index, handle) => {
          const error = pattern ? regexError(pattern) : '未填写，这一条不会生效';
          return <RoutingCard invalid={!!pattern && !!error} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[auto_minmax(0,1fr)_auto]">
            <div className="flex items-center gap-2">
              {handle}
              <span className="w-5 text-center font-mono text-[12px] text-ink-muted">{index + 1}</span>
            </div>
            <DraftInput placeholder="按此正则匹配节点，排在上面的优先" aria-label={`优先级 ${index + 1}`} className={cx('col-span-2 row-start-2 h-9 min-w-0 font-mono sm:col-span-1 sm:col-start-2 sm:row-start-1', pattern && error && 'border-err')} value={pattern} aria-invalid={!!pattern && !!error}
              onCommit={(value) => onChange({ ...step, patterns: step.patterns.map((item, i) => i === index ? value : item) })} />
            <div className="col-start-2 row-start-1 flex items-center gap-2 sm:col-start-3">
              <HitCount value={hits(step.patterns)?.[index]} />
              <DeleteIcon label={`删除优先级 ${index + 1}`} onClick={() => onChange({ ...step, patterns: step.patterns.filter((_, i) => i !== index) })} />
            </div>
            {error && <span role="status" className={cx('col-span-full text-[12px]', pattern ? 'text-err' : 'text-ink-muted')}>{error}</span>}
          </RoutingCard>;
        }} />
        {!step.patterns.length && <div className="mt-3"><Empty title="尚未添加优先级" /></div>}
      </div>;
    case 'rename.regex': {
      const counts = names ? renameHits(step.rules, names) : undefined;
      const setRule = (index: number, patch: Partial<(typeof step.rules)[number]>) => onChange({ ...step, rules: step.rules.map((rule, i) => i === index ? { ...rule, ...patch } : rule) });
      return <div>
        <FormHeader title="改名规则" action={<AddButton onClick={() => onChange({ ...step, rules: [...step.rules, { pattern: '', replace: '' }] })}>添加规则</AddButton>} />
        {step.rules.map((rule, index) => {
          const error = rule.pattern ? regexError(rule.pattern, (rule.flags ?? '').replace('g', '') + 'g') : '匹配正则未填写，这条规则不会生效';
          return <RoutingCard key={index} invalid={!!rule.pattern && !!error} className="flex flex-col items-stretch">
            <div className="flex items-center gap-2">
              <span className="flex-1 text-[12.5px] font-medium text-ink-2">规则 {index + 1}</span>
              <HitCount value={counts?.[index]} />
              <DeleteIcon label={`删除规则 ${index + 1}`} onClick={() => onChange({ ...step, rules: step.rules.filter((_, i) => i !== index) })} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className={ROW}><span className={lbl}>匹配（正则）</span>
                <DraftInput aria-label={`规则 ${index + 1} 匹配正则`} className={cx('h-9 min-w-0 font-mono', rule.pattern && error && 'border-err')} placeholder="匹配节点名称中需要替换的部分" value={rule.pattern}
                  aria-invalid={!!rule.pattern && !!error} onCommit={(pattern) => setRule(index, { pattern })} />
              </label>
              <label className={ROW}><span className={lbl}>替换为</span>
                <DraftInput aria-label={`规则 ${index + 1} 替换为`} className="h-9 min-w-0 font-mono" placeholder="替换后的文字，可用 $1 引用分组" value={rule.replace} onCommit={(replace) => setRule(index, { replace })} />
              </label>
            </div>
            {error && <span role="status" className={cx('text-[12px]', rule.pattern ? 'text-err' : 'text-ink-muted')}>{error}</span>}
          </RoutingCard>;
        })}
        {!step.rules.length && <div className="my-3"><Empty title="尚未添加改名规则" /></div>}
        <p className={cx(hint, 'm-0 mt-2')}>替换支持 $1、$2；(?i) 忽略大小写</p>
      </div>;
    }
    case 'rename.affix': {
      const sample = names?.[0] ?? '🇭🇰 HK-01';
      return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5"><span className={lbl}>前缀</span><DraftInput className="h-9 font-mono" placeholder="添加到节点名称开头的文字" value={step.prefix ?? ''} onCommit={(prefix) => onChange({ ...step, prefix })} /></label>
        <label className="flex flex-col gap-1.5"><span className={lbl}>后缀</span><DraftInput className="h-9 font-mono" placeholder="添加到节点名称末尾的文字" value={step.suffix ?? ''} onCommit={(suffix) => onChange({ ...step, suffix })} /></label>
        <span className={cx(hint, 'sm:col-span-2')}>示例：<span className="font-mono">{sample}</span> → <span className="font-mono">{step.prefix ?? ''}{sample}{step.suffix ?? ''}</span></span>
      </div>;
    }
    case 'flag':
      return <div className="flex flex-col gap-2">
        <ChoiceField label="旗帜" value={step.mode} options={[{ value: 'add', label: '添加旗帜' }, { value: 'remove', label: '移除旗帜' }]} onChange={(mode) => onChange({ ...step, mode })} />
      </div>;
    case 'sort.name':
      return <div className="flex flex-col gap-2">
        <ChoiceField label="顺序" value={step.order} options={[{ value: 'asc', label: '升序' }, { value: 'desc', label: '降序' }]} onChange={(order) => onChange({ ...step, order })} />
        <span className={hint}>自然排序：HK-2 排在 HK-10 前面。</span>
      </div>;
    case 'dedupe':
      return <div className="flex flex-col gap-2.5">
        <div><ChoiceField label="判重依据" value={step.by ?? 'name'} options={[{ value: 'name', label: '按名称' }, { value: 'key', label: '按节点身份' }]} onChange={(by) => onChange({ ...step, by })} /></div>
        <div><ChoiceField label="重复时" value={step.strategy} options={[{ value: 'drop', label: '删除重复' }, { value: 'suffix', label: '追加序号' }]} onChange={(strategy) => onChange({ ...step, strategy })} /></div>
        <span className={hint}>节点身份 = 协议 + 服务器 + 端口 + 凭据。保留先出现的那个。</span>
      </div>;
    case 'set':
      return <SetFieldsForm fields={step.fields} onChange={(fields) => onChange({ ...step, fields })} />;
    case 'script':
      return <div className="flex flex-col gap-2">
        <label htmlFor="script-code" className={lbl}>处理脚本</label>
        <DraftTextarea placeholder="填写接收 nodes 和 ctx 并返回节点列表的脚本" id="script-code" rows={7} className="font-mono text-[12.5px]" value={step.code} onCommit={(code) => onChange({ ...step, code })} />
        <span className={hint}>需要脚本权限；执行失败时跳过。</span>
      </div>;
  }
}

