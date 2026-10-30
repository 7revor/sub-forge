import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuItem } from './ui/dropdown-menu.tsx';
import { alertError } from '../feedback.ts';
import { OptionalBoolean } from './OptionalBoolean.tsx';
import { proxyPlaceholders } from '../schemas/placeholders.ts';
// 处理链编辑器（SRC-06，设计稿「订阅源 · 编辑处理步骤」「处理器参数表单」）：
// 左侧步骤列表（拖拽排序、节点数变化、添加处理器菜单）；自动去重仅计入最终输出。
// 右侧选中步骤的参数（灰底区域）+ 启用开关 / 删除，下方分别展示这一步的输入列表与输出列表；
// 未选择步骤时展示原始节点与最终结果的总览；点击编辑器之外取消选择。

import { DEFAULT_USELESS_PATTERNS, type OperatorStep } from '@sub-forge/core';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ExtraFields } from './ExtraFields.tsx';
import { patternHits, regexError, renameHits, setFieldsError, updateSetField } from './pipelineForm.ts';
import { mapRows, mapStats } from './pipelineMap.ts';
import { SortableList } from './SortableList.tsx';
import type { PipelinePreview, TraceStep } from '../api.ts';
import { Badge, Button, DraftInput, DraftTextarea, Empty, ErrorAlert, Input, Segmented, Select, Switch, cx } from './ui.tsx';

export const OP_LABEL: Record<OperatorStep['op'], string> = {
  'filter.useless': '无用节点过滤',
  'filter.regex': '正则过滤',
  'filter.type': '协议类型过滤',
  'rename.regex': '正则改名',
  'rename.delete': '正则删除字符',
  'rename.affix': '前缀 / 后缀',
  flag: '地区旗帜',
  'sort.name': '按名称排序',
  'sort.regex': '按正则优先级排序',
  dedupe: '去重',
  set: '快捷设置',
  script: '脚本',
};

const OP_GROUPS: { title: string; ops: OperatorStep['op'][] }[] = [
  { title: '过滤', ops: ['filter.useless', 'filter.regex', 'filter.type'] },
  { title: '改名', ops: ['rename.regex', 'rename.delete', 'rename.affix', 'flag'] },
  { title: '排序', ops: ['sort.name', 'sort.regex'] },
  { title: '其他', ops: ['dedupe', 'set', 'script'] },
];

const NEW_STEP: Record<OperatorStep['op'], () => OperatorStep> = {
  'filter.useless': () => ({ op: 'filter.useless' }),
  'filter.regex': () => ({ op: 'filter.regex', patterns: [''], keep: false }),
  'filter.type': () => ({ op: 'filter.type', types: ['ss'], keep: false }),
  'rename.regex': () => ({ op: 'rename.regex', rules: [{ pattern: '', replace: '' }] }),
  'rename.delete': () => ({ op: 'rename.delete', patterns: [''] }),
  'rename.affix': () => ({ op: 'rename.affix', prefix: '' }),
  flag: () => ({ op: 'flag', mode: 'add' }),
  'sort.name': () => ({ op: 'sort.name', order: 'asc' }),
  'sort.regex': () => ({ op: 'sort.regex', patterns: ['HK', 'JP', 'SG', 'US'] }),
  dedupe: () => ({ op: 'dedupe', strategy: 'suffix', by: 'name' }),
  set: () => ({ op: 'set', fields: { udp: true } }),
  script: () => ({ op: 'script', code: '(nodes, ctx) => nodes' }),
};

export function stepSummary(s: OperatorStep): string {
  switch (s.op) {
    case 'filter.regex': return `${s.keep ? '保留' : '剔除'} ${s.patterns.filter(Boolean).join(' | ') || '（未填写）'}`;
    case 'filter.type': return `${s.keep ? '保留' : '剔除'} ${s.types.map(type => type.toUpperCase()).join(', ')}`;
    case 'filter.useless': return s.patterns?.length ? s.patterns.join(' | ') : '默认关键词（剩余流量、到期、官网…）';
    case 'rename.regex': return `${s.rules.filter((r) => r.pattern).length} 条规则 · 正则链`;
    case 'rename.delete': return s.patterns.filter(Boolean).join(' | ') || '（未填写）';
    case 'rename.affix': return `${s.prefix ?? ''}…${s.suffix ?? ''}`;
    case 'flag': return s.mode === 'add' ? '按名称识别地区，前置旗帜' : '移除旗帜';
    case 'sort.name': return s.order === 'asc' ? '升序' : '降序';
    case 'sort.regex': return s.patterns.filter(Boolean).join(' > ');
    case 'dedupe': return `${s.by === 'key' ? '按节点身份' : '按名称'} · ${s.strategy === 'drop' ? '删除重复' : '追加序号'}`;
    case 'set': return Object.entries(s.fields).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ');
    case 'script': return '自定义脚本';
  }
}

const lbl = 'text-[12.5px] font-medium text-ink-muted';
const hint = 'text-[12px] leading-relaxed text-ink-muted';

function DeleteIcon({ label, onClick }: { label: string; onClick: () => void }) {
  return <Button variant="ghost" size="sm" className="w-8 px-0" aria-label={label} onClick={onClick}><Trash2 size={14} /></Button>;
}

/** 一行一个正则：序号、输入框、命中数、删除；空行提示不会生效，非法正则标红 */
function PatternRows({ label, patterns, hits, onChange, addLabel = '添加正则', flags = '', placeholder = '按节点名称匹配的正则表达式' }: {
  label: string; patterns: string[]; hits?: (number | undefined)[]; onChange: (patterns: string[]) => void; addLabel?: string; flags?: string; placeholder?: string;
}) {
  const grid = 'grid grid-cols-[22px_minmax(0,1fr)_44px_32px] items-center gap-2';
  return (
    <div className="flex flex-col gap-2">
      <div className={grid}><span className={lbl}>#</span><span className={lbl}>{label}</span><span className={cx(lbl, 'text-right')}>命中</span><span /></div>
      {patterns.map((p, i) => {
        const error = p ? regexError(p, flags) : '未填写，这一条不会生效';
        return (
          <div key={i} className="flex flex-col gap-1">
            <div className={grid}>
              <span className="font-mono text-[12px] text-ink-muted">{i + 1}</span>
              <DraftInput aria-label={`${label} ${i + 1}`} className={cx('h-9 min-w-0 font-mono', p && error && 'border-err bg-[#fffbfa]')} placeholder={placeholder} value={p}
                aria-invalid={!!p && !!error} onCommit={(v) => onChange(patterns.map((x, j) => (j === i ? v : x)))} />
              <span className="text-right font-mono text-[12.5px] text-ink-2">{hits?.[i] ?? '—'}</span>
              <DeleteIcon label={`删除第 ${i + 1} 条`} onClick={() => onChange(patterns.filter((_, j) => j !== i))} />
            </div>
            {error && <span role="status" className={cx('pl-[30px] text-[12px]', p ? 'text-err' : 'text-ink-muted')}>{error}</span>}
          </div>
        );
      })}
      <Button size="sm" className="w-fit" onClick={() => onChange([...patterns, ''])}><Plus size={14} />{addLabel}</Button>
    </div>
  );
}

const SET_BOOLS = ['udp', 'tfo', 'skip-cert-verify'] as const;
const SET_SELECTS = {
  'client-fingerprint': ['chrome', 'firefox', 'safari', 'ios', 'android', 'edge', '360', 'qq', 'random', 'randomized'],
  'ip-version': ['dual', 'ipv4', 'ipv6', 'ipv4-prefer', 'ipv6-prefer'],
};
const SET_KEYS = [...SET_BOOLS, ...Object.keys(SET_SELECTS)];
const PROTOCOLS = ['ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic', 'anytls', 'socks5', 'http', 'snell'];
const ROW = 'grid grid-cols-[150px_minmax(0,1fr)] items-center gap-3';

function SetFieldsForm({ fields, onChange }: { fields: Record<string, unknown>; onChange: (fields: Record<string, unknown>) => void }) {
  const [error, setError] = useState<string>();
  const extra = Object.fromEntries(Object.entries(fields).filter(([key]) => !SET_KEYS.includes(key)));
  // 字段名由公共编辑器显式校验，提交时再校验完整数据。
  return <div className="flex flex-col gap-2.5">
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
    <div className="flex flex-col gap-2 border-t border-line pt-2.5">
      <span className={lbl}>其他字段</span>
      <ExtraFields value={extra} validateName={(key) => setFieldsError({ [key]: null }) || (SET_KEYS.includes(key) ? '请使用上方控件修改该字段' : undefined)} onChange={(next) => {
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
    <Segmented label="命中后" value={step.keep ? 'keep' : 'drop'} options={[{ value: 'drop', label: '剔除选中的协议' }, { value: 'keep', label: '只保留选中的协议' }]} onChange={(v) => onChange({ ...step, keep: v === 'keep' })} />
    <fieldset className="m-0 grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2 border-0 p-0">
      <legend className="sr-only">协议类型（至少选一个）</legend>
      {[...new Set([...PROTOCOLS, ...step.types])].map((type) => {
        const on = step.types.includes(type);
        return <label key={type} className={cx('flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-2.5 font-mono text-[13px]', on ? 'border-brand bg-[#f5f8ff] font-medium text-accent-ink' : 'border-[#d5d9e0] bg-panel')}>
          <input type="checkbox" checked={on} onChange={(e) => {
            const types = e.target.checked ? [...step.types, type] : step.types.filter((v) => v !== type);
            if (!types.length) { alertError('至少选择一个协议类型'); return; }
            onChange({ ...step, types });
          }} />{type.toUpperCase()}
        </label>;
      })}
    </fieldset>
    <div className="flex gap-2">
      <Input aria-label="其他协议" className="h-9 max-w-[280px] font-mono" placeholder="其他协议，如 wireguard" value={custom} onChange={(e) => setCustom(e.target.value)} />
      <Button size="sm" className="h-9" onClick={() => {
        const type = custom.trim().toLowerCase();
        if (!type) { alertError('请输入协议类型'); return; }
        onChange({ ...step, types: [...new Set([...step.types, type])] }); setCustom('');
      }}>添加</Button>
    </div>
  </div>;
}

function StepForm({ step, names, onChange }: { step: OperatorStep; names: string[] | undefined; onChange: (s: OperatorStep) => void }) {
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
        <Segmented label="命中后" value={step.keep ? 'keep' : 'drop'} options={[{ value: 'drop', label: '剔除命中' }, { value: 'keep', label: '只保留命中' }]} onChange={(v) => onChange({ ...step, keep: v === 'keep' })} />
        <PatternRows label="正则（命中任一条即算命中）" patterns={step.patterns} hits={hits(step.patterns)} onChange={(patterns) => onChange({ ...step, patterns })} />
      </div>;
    case 'filter.type':
      return <TypeFilterForm step={step} onChange={onChange} />;
    case 'rename.delete':
      return <div className="flex flex-col gap-2">
        <PatternRows label="要删除的部分（正则）" patterns={step.patterns} hits={hits(step.patterns)} flags="g" onChange={(patterns) => onChange({ ...step, patterns })} />
      </div>;
    case 'sort.regex':
      return <div className="flex flex-col gap-2">
        <span className={lbl}>优先级（从上到下）</span>
        <SortableList items={step.patterns} onReorder={(patterns) => onChange({ ...step, patterns })} renderItem={(p, i, handle) => (
          <div className="grid grid-cols-[24px_22px_minmax(0,1fr)_44px_32px] items-center gap-2 py-1">
            {handle}
            <span className="font-mono text-[12px] text-ink-muted">{i + 1}</span>
            <DraftInput placeholder="按此正则匹配节点，排在上面的优先" aria-label={`优先级 ${i + 1}`} className={cx('h-9 min-w-0 font-mono', p && regexError(p) && 'border-err')} value={p} aria-invalid={!!p && !!regexError(p)}
              onCommit={(v) => onChange({ ...step, patterns: step.patterns.map((x, j) => (j === i ? v : x)) })} />
            <span className="text-right font-mono text-[12.5px] text-ink-2">{hits(step.patterns)?.[i] ?? '—'}</span>
            <DeleteIcon label={`删除优先级 ${i + 1}`} onClick={() => onChange({ ...step, patterns: step.patterns.filter((_, j) => j !== i) })} />
          </div>
        )} />
        <Button size="sm" className="w-fit" onClick={() => onChange({ ...step, patterns: [...step.patterns, ''] })}><Plus size={14} />添加</Button>
      </div>;
    case 'rename.regex': {
      const grid = 'grid grid-cols-[22px_minmax(0,1fr)_16px_minmax(0,1fr)_44px_32px] items-center gap-2';
      const counts = names ? renameHits(step.rules, names) : undefined;
      const setRule = (i: number, patch: Partial<(typeof step.rules)[number]>) => onChange({ ...step, rules: step.rules.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
      return <div className="flex flex-col gap-2">
        <div className={grid}><span className={lbl}>#</span><span className={lbl}>匹配（正则）</span><span /><span className={lbl}>替换为</span><span className={cx(lbl, 'text-right')}>命中</span><span /></div>
        {step.rules.map((r, i) => {
          const error = r.pattern ? regexError(r.pattern, (r.flags ?? '').replace('g', '') + 'g') : '匹配正则未填写，这条规则不会生效';
          return <div key={i} className="flex flex-col gap-1">
            <div className={grid}>
              <span className="font-mono text-[12px] text-ink-muted">{i + 1}</span>
              <DraftInput aria-label={`规则 ${i + 1} 匹配正则`} className={cx('h-9 min-w-0 font-mono', r.pattern && error && 'border-err bg-[#fffbfa]')} placeholder="匹配节点名称中需要替换的部分" value={r.pattern}
                aria-invalid={!!r.pattern && !!error} onCommit={(pattern) => setRule(i, { pattern })} />
              <span aria-hidden="true" className="text-center text-faint">→</span>
              <DraftInput aria-label={`规则 ${i + 1} 替换为`} className="h-9 min-w-0 font-mono" placeholder="替换后的文字，可用 $1 引用分组" value={r.replace} onCommit={(replace) => setRule(i, { replace })} />
              <span className="text-right font-mono text-[12.5px] text-ink-2">{counts?.[i] ?? '—'}</span>
              <DeleteIcon label={`删除规则 ${i + 1}`} onClick={() => onChange({ ...step, rules: step.rules.filter((_, j) => j !== i) })} />
            </div>
            {error && <span role="status" className={cx('pl-[30px] text-[12px]', r.pattern ? 'text-err' : 'text-ink-muted')}>{error}</span>}
          </div>;
        })}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-0.5">
          <Button size="sm" onClick={() => onChange({ ...step, rules: [...step.rules, { pattern: '', replace: '' }] })}><Plus size={14} />添加规则</Button>
          <span className={hint}>替换支持 $1、$2；(?i) 忽略大小写</span>
        </div>
      </div>;
    }
    case 'rename.affix': {
      const sample = names?.[0] ?? '🇭🇰 HK-01';
      return <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5"><span className={lbl}>前缀</span><DraftInput className="h-9 font-mono" placeholder="添加到节点名称开头的文字" value={step.prefix ?? ''} onCommit={(prefix) => onChange({ ...step, prefix })} /></label>
        <label className="flex flex-col gap-1.5"><span className={lbl}>后缀</span><DraftInput className="h-9 font-mono" placeholder="添加到节点名称末尾的文字" value={step.suffix ?? ''} onCommit={(suffix) => onChange({ ...step, suffix })} /></label>
        <span className={cx(hint, 'col-span-2')}>示例：<span className="font-mono">{sample}</span> → <span className="font-mono">{step.prefix ?? ''}{sample}{step.suffix ?? ''}</span></span>
      </div>;
    }
    case 'flag':
      return <div className="flex flex-col gap-2">
        <Segmented label="旗帜" value={step.mode} options={[{ value: 'add', label: '添加旗帜' }, { value: 'remove', label: '移除旗帜' }]} onChange={(mode) => onChange({ ...step, mode })} />
      </div>;
    case 'sort.name':
      return <div className="flex flex-col gap-2">
        <Segmented label="顺序" value={step.order} options={[{ value: 'asc', label: '升序' }, { value: 'desc', label: '降序' }]} onChange={(order) => onChange({ ...step, order })} />
        <span className={hint}>自然排序：HK-2 排在 HK-10 前面。</span>
      </div>;
    case 'dedupe':
      return <div className="flex flex-col gap-2.5">
        <div className={ROW}><span className={lbl}>判重依据</span><Segmented label="判重依据" value={step.by ?? 'name'} options={[{ value: 'name', label: '按名称' }, { value: 'key', label: '按节点身份' }]} onChange={(by) => onChange({ ...step, by })} /></div>
        <div className={ROW}><span className={lbl}>重复时</span><Segmented label="重复时" value={step.strategy} options={[{ value: 'drop', label: '删除重复' }, { value: 'suffix', label: '追加序号' }]} onChange={(strategy) => onChange({ ...step, strategy })} /></div>
        <span className={hint}>节点身份 = 协议 + 服务器 + 端口 + 凭据。保留先出现的那个。</span>
      </div>;
    case 'set':
      return <SetFieldsForm fields={step.fields} onChange={(fields) => onChange({ ...step, fields })} />;
    case 'script':
      return <div className="flex flex-col gap-2">
        <label htmlFor="script-code" className={lbl}>{'(nodes, ctx) => nodes'}</label>
        <DraftTextarea placeholder="填写接收 nodes 和 ctx 并返回节点列表的脚本" id="script-code" rows={7} className="bg-panel font-mono text-[12.5px]" value={step.code} onCommit={(code) => onChange({ ...step, code })} />
        <span className={hint}>需要脚本权限；执行失败时跳过。</span>
      </div>;
  }
}

function AddMenu({ onAdd }: { onAdd: (op: OperatorStep['op']) => void }) {
  return <div className="border-t border-line-2 px-4 pt-3 pb-2">
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button className="w-full border-dashed"><Plus size={16} />添加处理器</Button></DropdownMenuTrigger>
      <DropdownMenuContent aria-label="选择处理器" align="start" className="w-[max(240px,var(--radix-dropdown-menu-trigger-width))]">
        {OP_GROUPS.map(group => <DropdownMenuGroup key={group.title}>
          <DropdownMenuLabel>{group.title}</DropdownMenuLabel>
          {group.ops.map(op => <DropdownMenuItem key={op} onSelect={() => onAdd(op)}>{OP_LABEL[op]}</DropdownMenuItem>)}
        </DropdownMenuGroup>)}
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}

function StepCount({ trace }: { trace?: TraceStep }) {
  if (!trace) return null;
  if (trace.error) return <Badge tone="err">失败</Badge>;
  const delta = trace.after - trace.before;
  return <span className="shrink-0 font-mono text-[12.5px] text-ink-2">{trace.after}
    {delta !== 0 && <span className={delta < 0 ? 'text-err' : 'text-ok'}> {delta > 0 ? '+' : '−'}{Math.abs(delta)}</span>}
    {delta === 0 && trace.renamed.length > 0 && <span className="text-ok"> ~{trace.renamed.length}</span>}
  </span>;
}

function StepRow({ handle, index, step, selected, onSelect, trace }: {
  handle: ReactNode; index: number; step: OperatorStep; selected: boolean; onSelect: () => void; trace?: TraceStep;
}) {
  const enabled = step.enabled !== false;
  return (
    <div className={cx('flex min-h-[66px] items-center gap-1 border-t border-line-2 pl-2', selected ? 'bg-accent-soft' : 'bg-panel')}>
      {handle}
      <button type="button" onClick={onSelect} aria-current={selected || undefined} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-3 pr-4 pl-1 text-left">
        <span className={cx('grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md font-mono text-[12px]', selected ? 'bg-brand text-white' : 'bg-[#ebedf1] text-ink-2')}>{index + 1}</span>
        <span className={cx('flex min-w-0 flex-1 flex-col gap-0.5', !enabled && 'opacity-50')}>
          <span className="text-[13.5px] font-medium">{OP_LABEL[step.op]}{!enabled && <span className="ml-1.5 text-[12px] font-normal text-ink-muted">已停用</span>}</span>
          <span className="truncate font-mono text-[12px] text-ink-muted">{stepSummary(step)}</span>
        </span>
        {enabled && <StepCount {...(trace ? { trace } : {})} />}
      </button>
    </div>
  );
}

function resultText(t: TraceStep): string {
  if (t.error) return `这一步失败，已跳过：${t.error}`;
  if (!t.enabled) return '这一步已停用，结果与上一步相同';
  const parts = [`${t.before} → ${t.after} 个节点`];
  if (t.renamed.length) parts.push(`改名 ${t.renamed.length}`);
  if (t.removed.length) parts.push(`移除 ${t.removed.length}`);
  if (!t.renamed.length && !t.removed.length && t.before === t.after) parts.push(t.op.startsWith('sort') ? '仅调整顺序' : '没有变化');
  return parts.join('，');
}

/** 未选择处理器时展示总览；自动去重不作为可选步骤展示。 */
const OVERVIEW = -1;

type Side = { names: string[]; origins: (number | null)[] };
/** 两侧独立排列与滚动，不按节点来源配对，也不补齐缺失行。 */
function InputOutputView({ before, after, inLabel, outLabel, truncated }: {
  before: Side; after: Side; inLabel: string; outLabel: string; truncated?: boolean;
}) {
  return <>
    <div className="pipeline-mapping-scroll mx-4 grid grid-cols-2 gap-4">
      {[{ side: before, label: inLabel }, { side: after, label: outLabel }].map(({ side, label }, column) => (
        <section key={column} aria-label={label} className="min-h-0 min-w-0 overflow-auto overscroll-contain">
          <table className="w-full border-collapse text-[13px]">
            <thead className="sticky top-0 z-[1] bg-panel">
              <tr>
                <th className="w-10 border-b border-line px-3 py-2 text-right text-[12px] font-medium text-faint">#</th>
                <th className="border-b border-line px-3 py-2 text-left text-[12px] font-medium whitespace-nowrap text-ink-muted">{label} <span className="font-normal text-faint">{side.names.length}</span></th>
              </tr>
            </thead>
            <tbody>
              {side.names.map((name, index) => <tr key={index}>
                <td className="border-b border-line-2 px-3 py-[7px] text-right font-mono text-[12px] text-faint">{index + 1}</td>
                <td className="border-b border-line-2 px-3 py-[7px] font-mono whitespace-nowrap text-ink-2">{name}</td>
              </tr>)}
            </tbody>
          </table>
          {!side.names.length && <div className="py-3"><Empty title="没有节点" /></div>}
        </section>
      ))}
    </div>
    <div className="border-t border-line-2 px-4 pt-3 pb-4 text-[12.5px] text-ink-muted">
      输入 {before.names.length} 个 · 输出 {after.names.length} 个{truncated && ' · 节点较多，预览只包含前 500 个'}
    </div>
  </>;
}

export function PipelineEditor({ steps, onChange, preview, previewError, loading, inputLabel, title = '处理链' }: {
  steps: OperatorStep[];
  onChange: (s: OperatorStep[]) => void;
  preview?: PipelinePreview;
  previewError?: string;
  loading?: boolean;
  inputLabel?: string;
  /** 左栏标题，组合页用「组合自身的处理链」 */
  title?: string;
}) {
  // dnd-kit 需要稳定的 id：按位置生成，拖动时随数组一起移动
  const [ids, setIds] = useState<string[]>(() => steps.map((_, i) => `s${i}`));
  const [seq, setSeq] = useState(steps.length);
  const [selected, setSelected] = useState(OVERVIEW);
  // React 捕获阶段同时覆盖参数下拉等 Portal，避免内部操作被当作外部点击。
  const internalClicks = useRef(new WeakSet<Event>());
  useEffect(() => {
    const clearSelection = (event: MouseEvent) => {
      if (!internalClicks.current.has(event)) setSelected(OVERVIEW);
    };
    document.addEventListener('click', clearSelection);
    return () => document.removeEventListener('click', clearSelection);
  }, []);
  const keys = ids.length === steps.length ? ids : steps.map((_, i) => ids[i] ?? `x${i}`);
  const add = (op: OperatorStep['op']) => {
    onChange([...steps, NEW_STEP[op]()]);
    setIds([...keys, `s${seq}`]);
    setSeq(seq + 1);
    setSelected(steps.length);
  };
  const remove = (i: number) => {
    onChange(steps.filter((_, j) => j !== i));
    setIds(keys.filter((_, j) => j !== i));
    setSelected(steps.length <= 1 ? OVERVIEW : Math.min(selected, steps.length - 2));
  };

  const trace = preview?.trace;
  const last = trace?.at(-1);
  const mode = selected === OVERVIEW || selected >= steps.length ? 'overview' : 'step';
  const step = mode === 'step' ? steps[selected] : undefined;
  const cur = mode === 'overview' ? undefined : trace?.[selected];
  const enabled = step?.enabled !== false;

  // 每一步的节点与来源序号；-1 为原始输入
  const sides = useMemo(() => {
    if (!preview) return undefined;
    const input: Side = { names: preview.inputNodes.map((n) => n.name), origins: preview.inputNodes.map((_, i) => i) };
    return [input, ...preview.trace.map((t): Side => ({ names: t.nodes.map((n) => n.name), origins: t.origins }))];
  }, [preview]);
  const sideAt = (k: number) => sides?.[k + 1];
  const finalSide = sides?.at(-1);
  const truncated = !!preview && (preview.input > preview.inputNodes.length || preview.trace.some((t) => t.truncated));
  const before = mode === 'overview' ? sideAt(-1) : sideAt(selected - 1);
  const after = mode === 'overview' ? finalSide : sideAt(selected);

  const overviewStats = useMemo(() => (sides && finalSide ? mapStats(mapRows(sides[0]!, finalSide)) : undefined), [sides, finalSide]);

  return (
    <div className="pipeline-workspace" onClickCapture={(event) => internalClicks.current.add(event.nativeEvent)}>
      <ErrorAlert error={previewError} />
      <section aria-label={title} className="pipeline-steps rounded-[10px] border border-line bg-panel pt-4 pb-2">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 pb-3">
          <h2 className="m-0 text-[15px] font-semibold">{title}</h2>
          <span className="text-[12.5px] text-ink-muted">{inputLabel ?? `输入 ${preview?.input ?? '—'} 个节点`}</span>
        </div>
        <div className="pipeline-step-scroll">
        <SortableList items={steps.map((s, i) => ({ step: s, id: keys[i]! }))} getKey={(item) => item.id}
          onReorder={(items, { to }) => {
            setIds(items.map((item) => item.id));
            onChange(items.map((item) => item.step));
            setSelected(to);
          }}
          renderItem={({ step: s }, i, handle) => (
            <StepRow handle={handle} index={i} step={s} selected={mode === 'step' && i === selected} onSelect={() => setSelected(i)} {...(trace?.[i] ? { trace: trace[i] } : {})} />
          )} />
        </div>
        <AddMenu onAdd={add} />
      </section>

      <section aria-label="编辑与预览" className="pipeline-preview rounded-[10px] border border-line bg-panel">
        {mode === 'overview' && <>
          <div className="flex flex-col gap-2.5 px-4 pt-4 pb-3">
            <div className="flex flex-col gap-0.5">
              <h2 className="m-0 text-[15px] font-semibold">总览 · 原始 → 最终</h2>
            </div>
            {preview && overviewStats && <div className="flex flex-wrap gap-1.5">
              <Badge>原始 {preview.input}</Badge>
              <Badge>最终 {last ? last.after : preview.input}</Badge>
              {overviewStats.renamed > 0 && <Badge tone="ok">改名 {overviewStats.renamed}</Badge>}
              {overviewStats.removed > 0 && <Badge tone="err">移除 {overviewStats.removed}</Badge>}
              {overviewStats.added > 0 && <Badge tone="ok">新增 {overviewStats.added}</Badge>}
              {overviewStats.moved > 0 && <Badge>调整顺序 {overviewStats.moved}</Badge>}
            </div>}
            {loading && <span className="text-[12.5px] text-ink-muted">预览中…</span>}
          </div>
          {before && after && <InputOutputView before={before} after={after} inLabel="输入" outLabel="输出" truncated={truncated} />}
          {!preview && !previewError && <div className="px-4 pb-4 text-[13px] text-ink-muted">{loading ? '预览中…' : '保存后可预览'}</div>}
        </>}

        {mode === 'step' && step && <>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 pb-3">
            <div className="flex flex-col gap-0.5">
              <h2 className="m-0 text-[15px] font-semibold">第 {selected + 1} 步 · {OP_LABEL[step.op]}</h2>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="flex items-center gap-2 text-[13px] text-ink-2">
                <Switch label="启用这一步" checked={enabled} onChange={(v) => onChange(steps.map((x, j) => (j === selected ? { ...x, enabled: v } : x)))} />启用
              </span>
              <Button variant="ghost" size="sm" className="text-err" onClick={() => remove(selected)}><Trash2 size={14} />删除步骤</Button>
            </div>
          </div>
          {cur?.error && <div role="alert" className="mx-4 mb-3 rounded-lg bg-err-soft px-3 py-2 text-[13px] text-[#8f2a1f]">这一步失败，已跳过：{cur.error}</div>}
          <div className="mx-4 mb-4 flex flex-col gap-2.5 rounded-lg bg-ground p-3.5">
            <StepForm key={`${keys[selected]}-${step.op}`} step={step} names={before?.names}
              onChange={(s) => onChange(steps.map((x, j) => (j === selected ? { ...s, ...(x.enabled === false ? { enabled: false } : {}) } : x)))} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-2 px-4 pt-3 pb-3">
            <h3 className="m-0 text-[13.5px] font-semibold">这一步的输入 → 输出 <span className="font-normal text-ink-muted">· {loading ? '预览中…' : cur ? resultText(cur) : '保存后可预览'}</span></h3>
          </div>
          {cur && before && after && <InputOutputView before={before} after={after} inLabel="输入" outLabel="输出" truncated={truncated} />}
        </>}

        {preview && preview.failures.length > 0 && (
          <details className="border-t border-line-2 px-4 py-3 text-[12.5px]">
            <summary className="cursor-pointer text-brand">{preview.failures.length} 个节点解析失败</summary>
            <ul className="mt-2 flex flex-col gap-1 pl-4">{preview.failures.map((f, i) => <li key={i}><span className="font-mono">{f.line.slice(0, 80)}</span> — {f.reason}</li>)}</ul>
          </details>
        )}
      </section>
    </div>
  );
}
