// 处理链编辑器（SRC-06，设计稿「订阅源 · 编辑处理步骤」「处理器参数表单」）：
// 左侧步骤列表（拖拽排序、节点数变化、末尾自动去重兜底、添加处理器菜单）；
// 右侧选中步骤的参数（灰底区域）+ 启用开关 / 删除，下方是这一步输入 → 输出的逐节点对照；
// 列表顶部的「总览」对照原始节点与整条处理链跑完后的结果。

import { DEFAULT_USELESS_PATTERNS, type OperatorStep } from '@sub-forge/core';
import { ArrowLeftRight, Plus, Trash2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ExtraFields } from './ExtraFields.tsx';
import { patternHits, regexError, renameHits, rowHit, setFieldsError, updateSetField } from './pipelineForm.ts';
import { mapRows, mapStats, removedAtStep, renamedAtSteps, rowChanged, type MapRow } from './pipelineMap.ts';
import { SortableList } from './SortableList.tsx';
import type { PipelinePreview, TraceStep } from '../api.ts';
import { Badge, Button, DraftInput, DraftTextarea, Empty, Input, Segmented, Select, Switch, cx } from './ui.tsx';

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

const OP_DESC: Record<OperatorStep['op'], string> = {
  'filter.useless': '去掉剩余流量、到期、官网等公告节点',
  'filter.regex': '按名称剔除或只保留',
  'filter.type': '按协议剔除或只保留',
  'rename.regex': '匹配 → 替换，支持 $1',
  'rename.delete': '删掉名称中命中的部分',
  'rename.affix': '给所有节点加前后缀',
  flag: '按地区添加或移除旗帜',
  'sort.name': '自然排序，升序或降序',
  'sort.regex': '先命中的排前面',
  dedupe: '按名称或节点身份去重',
  set: '批量设置 udp、tfo 等字段',
  script: '自定义 (nodes, ctx) => nodes',
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
    case 'filter.type': return `${s.keep ? '保留' : '剔除'} ${s.types.join(', ')}`;
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

const lbl = 'text-[12.5px] font-medium text-muted';
const hint = 'text-[12px] leading-relaxed text-muted';

function DeleteIcon({ label, onClick }: { label: string; onClick: () => void }) {
  return <Button variant="ghost" size="sm" className="w-8 px-0" aria-label={label} onClick={onClick}><Trash2 size={14} /></Button>;
}

/** 一行一个正则：序号、输入框、命中数、删除；空行提示不会生效，非法正则标红 */
function PatternRows({ label, patterns, hits, onChange, addLabel = '添加正则', flags = '', placeholder }: {
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
              <span className="font-mono text-[12px] text-muted">{i + 1}</span>
              <DraftInput aria-label={`${label} ${i + 1}`} className={cx('h-9 min-w-0 font-mono', p && error && 'border-err bg-[#fffbfa]')} placeholder={placeholder} value={p}
                aria-invalid={!!p && !!error} onCommit={(v) => onChange(patterns.map((x, j) => (j === i ? v : x)))} />
              <span className="text-right font-mono text-[12.5px] text-ink-2">{hits?.[i] ?? '—'}</span>
              <DeleteIcon label={`删除第 ${i + 1} 条`} onClick={() => onChange(patterns.filter((_, j) => j !== i))} />
            </div>
            {error && <span role="status" className={cx('pl-[30px] text-[12px]', p ? 'text-err' : 'text-muted')}>{error}</span>}
          </div>
        );
      })}
      <Button size="sm" className="w-fit" onClick={() => onChange([...patterns, ''])}><Plus size={14} />{addLabel}</Button>
    </div>
  );
}

const SET_BOOLS = ['udp', 'tfo', 'skip-cert-verify'];
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
  // 公共 ExtraFields 没有键名校验接口，在此捕获输入并在写入前再次用内核校验。
  return <div className="flex flex-col gap-2.5">
    {SET_BOOLS.map((key) => <div key={key} className={ROW}><span className={cx(lbl, 'font-mono')}>{key}</span><Segmented label={key} size="sm"
      value={fields[key] === true ? 'on' : fields[key] === false ? 'off' : 'unset'}
      options={[{ value: 'unset', label: '不设置' }, { value: 'on', label: '开' }, { value: 'off', label: '关' }]}
      onChange={(v) => onChange(updateSetField(fields, key, v === 'unset' ? undefined : v === 'on'))} /></div>)}
    {Object.entries(SET_SELECTS).map(([key, options]) => {
      const value = fields[key] === undefined ? '' : String(fields[key]);
      return <div key={key} className={ROW}><span className={cx(lbl, 'font-mono')}>{key}</span><Select aria-label={key} className="h-9 max-w-[240px]" value={value}
        onChange={(e) => onChange(updateSetField(fields, key, e.target.value || undefined))}>
        <option value="">不设置</option>
        {value && !options.includes(value) && <option value={value}>{value}（当前值）</option>}
        {options.map((v) => <option key={v} value={v}>{v}</option>)}
      </Select></div>;
    })}
    <div className="flex flex-col gap-2 border-t border-line pt-2.5" onChangeCapture={(event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && (target.getAttribute('aria-label') === '新字段名称' || target.getAttribute('aria-label')?.endsWith('的字段名称'))) {
        const key = target.value.trim();
        setError(setFieldsError({ [key]: null }) || (SET_KEYS.includes(key) ? '请使用上方控件修改该字段' : undefined));
      }
    }}>
      <span className={lbl}>其他字段</span>
      <ExtraFields value={extra} onChange={(next) => {
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
  const [error, setError] = useState('');
  return <div className="flex flex-col gap-2.5">
    <Segmented label="命中后" value={step.keep ? 'keep' : 'drop'} options={[{ value: 'drop', label: '剔除选中的协议' }, { value: 'keep', label: '只保留选中的协议' }]} onChange={(v) => onChange({ ...step, keep: v === 'keep' })} />
    <fieldset className="m-0 grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2 border-0 p-0">
      <legend className="sr-only">协议类型（至少选一个）</legend>
      {[...new Set([...PROTOCOLS, ...step.types])].map((type) => {
        const on = step.types.includes(type);
        return <label key={type} className={cx('flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-2.5 font-mono text-[13px]', on ? 'border-accent bg-[#f5f8ff] font-medium text-accent-ink' : 'border-[#d5d9e0] bg-panel')}>
          <input type="checkbox" checked={on} onChange={(e) => {
            const types = e.target.checked ? [...step.types, type] : step.types.filter((v) => v !== type);
            if (!types.length) { setError('至少选择一个协议类型'); return; }
            setError(''); onChange({ ...step, types });
          }} />{type}
        </label>;
      })}
    </fieldset>
    <div className="flex gap-2">
      <Input aria-label="其他协议" className="h-9 max-w-[280px] font-mono" placeholder="其他协议，如 wireguard" value={custom} onChange={(e) => setCustom(e.target.value)} />
      <Button size="sm" className="h-9" onClick={() => {
        const type = custom.trim().toLowerCase();
        if (!type) { setError('请输入协议类型'); return; }
        onChange({ ...step, types: [...new Set([...step.types, type])] }); setCustom(''); setError('');
      }}>添加</Button>
    </div>
    {error && <div role="alert" className="text-[12px] text-err">{error}</div>}
  </div>;
}

function StepForm({ step, names, onChange }: { step: OperatorStep; names: string[] | undefined; onChange: (s: OperatorStep) => void }) {
  const hits = (patterns: string[]) => (names ? patternHits(patterns, names) : undefined);
  switch (step.op) {
    case 'filter.useless': {
      const value = step.patterns ?? [];
      return <div className="flex flex-col gap-2">
        <label htmlFor="useless" className={lbl}>关键词（正则，每行一条；命中任一条的节点被移除）</label>
        <DraftTextarea id="useless" rows={4} className="font-mono text-[12.5px]" value={value.join('\n')}
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
        <span className={hint}>多条依次执行。命中 0 个的规则不会报错，但值得检查是否写错。</span>
      </div>;
    case 'sort.regex':
      return <div className="flex flex-col gap-2">
        <span className={lbl}>优先级（先命中的排前面，拖动调整；未命中的保持原顺序排在最后）</span>
        <SortableList items={step.patterns} onReorder={(patterns) => onChange({ ...step, patterns })} renderItem={(p, i, handle) => (
          <div className="grid grid-cols-[24px_22px_minmax(0,1fr)_44px_32px] items-center gap-2 py-1">
            {handle}
            <span className="font-mono text-[12px] text-muted">{i + 1}</span>
            <DraftInput aria-label={`优先级 ${i + 1}`} className={cx('h-9 min-w-0 font-mono', p && regexError(p) && 'border-err')} value={p} aria-invalid={!!p && !!regexError(p)}
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
              <span className="font-mono text-[12px] text-muted">{i + 1}</span>
              <DraftInput aria-label={`规则 ${i + 1} 匹配正则`} className={cx('h-9 min-w-0 font-mono', r.pattern && error && 'border-err bg-[#fffbfa]')} placeholder="^香港\s*(\d+).*$" value={r.pattern}
                aria-invalid={!!r.pattern && !!error} onCommit={(pattern) => setRule(i, { pattern })} />
              <span aria-hidden="true" className="text-center text-faint">→</span>
              <DraftInput aria-label={`规则 ${i + 1} 替换为`} className="h-9 min-w-0 font-mono" placeholder="HK-$1" value={r.replace} onCommit={(replace) => setRule(i, { replace })} />
              <span className="text-right font-mono text-[12.5px] text-ink-2">{counts?.[i] ?? '—'}</span>
              <DeleteIcon label={`删除规则 ${i + 1}`} onClick={() => onChange({ ...step, rules: step.rules.filter((_, j) => j !== i) })} />
            </div>
            {error && <span role="status" className={cx('pl-[30px] text-[12px]', r.pattern ? 'text-err' : 'text-muted')}>{error}</span>}
          </div>;
        })}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-0.5">
          <Button size="sm" onClick={() => onChange({ ...step, rules: [...step.rules, { pattern: '', replace: '' }] })}><Plus size={14} />添加规则</Button>
          <span className={hint}>按顺序执行，上一条的结果交给下一条 · 替换支持 $1、$2 · (?i) 前缀忽略大小写</span>
        </div>
      </div>;
    }
    case 'rename.affix': {
      const sample = names?.[0] ?? '🇭🇰 HK-01';
      return <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5"><span className={lbl}>前缀</span><DraftInput className="h-9 font-mono" placeholder="不加" value={step.prefix ?? ''} onCommit={(prefix) => onChange({ ...step, prefix })} /></label>
        <label className="flex flex-col gap-1.5"><span className={lbl}>后缀</span><DraftInput className="h-9 font-mono" placeholder="不加" value={step.suffix ?? ''} onCommit={(suffix) => onChange({ ...step, suffix })} /></label>
        <span className={cx(hint, 'col-span-2')}>示例：<span className="font-mono">{sample}</span> → <span className="font-mono">{step.prefix ?? ''}{sample}{step.suffix ?? ''}</span></span>
      </div>;
    }
    case 'flag':
      return <div className="flex flex-col gap-2">
        <Segmented label="旗帜" value={step.mode} options={[{ value: 'add', label: '添加旗帜' }, { value: 'remove', label: '移除旗帜' }]} onChange={(mode) => onChange({ ...step, mode })} />
        <span className={hint}>按名称中的地区名或代码识别（香港 / HK / Hong Kong…）；流量、到期等说明节点不添加旗帜，已有旗帜的节点不重复添加。</span>
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
        <DraftTextarea id="script-code" rows={7} className="bg-panel font-mono text-[12.5px]" value={step.code} onCommit={(code) => onChange({ ...step, code })} />
        <span className={hint}>需要管理员授予脚本权限。在服务端沙箱中执行；出错时这一步被跳过，预览标为失败。</span>
      </div>;
  }
}

function AddMenu({ onAdd }: { onAdd: (op: OperatorStep['op']) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div ref={ref} className="flex flex-col gap-2 border-t border-line-2 px-4 pt-3 pb-2">
      <Button className="w-full border-dashed" aria-expanded={open} onClick={() => setOpen(!open)}><Plus size={16} />添加处理器</Button>
      {open && (
        <div role="menu" aria-label="选择处理器" className="flex flex-col gap-0.5 rounded-[10px] border border-line bg-panel p-1.5 shadow-[0_8px_24px_rgba(20,23,28,.10)]">
          {OP_GROUPS.map((g) => <div key={g.title} className="flex flex-col gap-0.5">
            <div className="px-2.5 pt-2 pb-1 text-[11px] tracking-[.08em] text-faint">{g.title}</div>
            {g.ops.map((op) => <button key={op} type="button" role="menuitem" onClick={() => { onAdd(op); setOpen(false); }}
              className="flex cursor-pointer flex-col gap-0.5 rounded-md px-2.5 py-2 text-left hover:bg-ground">
              <span className="text-[13.5px] font-medium">{OP_LABEL[op]}</span>
              <span className="text-[12px] text-muted">{OP_DESC[op]}</span>
            </button>)}
          </div>)}
        </div>
      )}
      <span className="text-center text-[12px] text-muted">新步骤追加到末尾，并自动选中</span>
    </div>
  );
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
    <div className={cx('flex items-center gap-1 border-t border-line-2 pl-2', selected ? 'bg-accent-soft' : 'bg-panel')}>
      {handle}
      <button type="button" onClick={onSelect} aria-current={selected || undefined} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-3 pr-4 pl-1 text-left">
        <span className={cx('grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md font-mono text-[12px]', selected ? 'bg-accent text-white' : 'bg-[#ebedf1] text-ink-2')}>{index + 1}</span>
        <span className={cx('flex min-w-0 flex-1 flex-col gap-0.5', !enabled && 'opacity-50')}>
          <span className="text-[13.5px] font-medium">{OP_LABEL[step.op]}{!enabled && <span className="ml-1.5 text-[12px] font-normal text-muted">已停用</span>}</span>
          <span className="truncate font-mono text-[12px] text-muted">{stepSummary(step)}</span>
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

/** 左侧列表中「总览」的序号；自动去重兜底的序号为 steps.length */
const OVERVIEW = -1;

type Side = { names: string[]; origins: (number | null)[] };
type MapOptions = { order: 'out' | 'in'; changedOnly: boolean };

const th = 'sticky top-0 z-[1] border-b border-line bg-panel px-3 py-2 text-left text-[12px] font-medium text-muted whitespace-nowrap';
const td = 'border-b border-line-2 px-3 py-[7px]';

/** main 的下内边距（py-7）+ 卡片下边框 */
const PAGE_BOTTOM = 29;
/** 视口太矮时对照表至少保留的高度，此时退回整页滚动 */
const MIN_SCROLL_HEIGHT = 320;

/**
 * 宽屏下让对照表填满视口剩余高度并在内部滚动，节点再多页面本身也不滚动，左侧导航与处理链保持不动；
 * 窄屏（处理链与预览上下堆叠）不限高。
 */
function useFillViewport(scroll: RefObject<HTMLElement | null>, footer: RefObject<HTMLElement | null>) {
  const [maxHeight, setMaxHeight] = useState<number>();
  useLayoutEffect(() => {
    const wide = window.matchMedia('(min-width: 768px)');
    const measure = () => {
      const el = scroll.current;
      if (!el || !wide.matches) { setMaxHeight(undefined); return; }
      const top = el.getBoundingClientRect().top + window.scrollY;
      const below = footer.current?.offsetHeight ?? 0;
      setMaxHeight(Math.max(MIN_SCROLL_HEIGHT, Math.floor(window.innerHeight - top - below - PAGE_BOTTOM)));
    };
    measure();
    // 页头徽章异步加载、参数表单增减行都会改变表格位置；只依赖位置计算，不会因自身限高反复触发
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    window.addEventListener('resize', measure);
    wide.addEventListener('change', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); wide.removeEventListener('change', measure); };
  }, [scroll, footer]);
  return maxHeight;
}

/** 输入 → 输出对照表：一行一个节点，左边是它进入时的样子，右边是出来时的样子 */
function MappingView({ before, after, inLabel, outLabel, extraLabel, extra, options, onOptions, truncated }: {
  before: Side; after: Side; inLabel: string; outLabel: string;
  extraLabel?: string; extra?: (r: MapRow) => ReactNode;
  options: MapOptions; onOptions: (o: MapOptions) => void; truncated?: boolean;
}) {
  const rows = useMemo(() => mapRows(before, after, options.order), [before, after, options.order]);
  const shown = options.changedOnly ? rows.filter(rowChanged) : rows;
  const scroll = useRef<HTMLDivElement>(null);
  const footer = useRef<HTMLDivElement>(null);
  const maxHeight = useFillViewport(scroll, footer);
  return <>
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3">
      <Segmented label="排列方式" size="sm" value={options.order} options={[{ value: 'out', label: '按输出顺序' }, { value: 'in', label: '按输入顺序' }]} onChange={(order) => onOptions({ ...options, order })} />
      <label className="flex cursor-pointer items-center gap-1.5 text-[13px] text-ink-2">
        <input type="checkbox" checked={options.changedOnly} onChange={(e) => onOptions({ ...options, changedOnly: e.target.checked })} />只看有变化的
      </label>
    </div>
    {shown.length ? <div ref={scroll} className="overflow-auto overscroll-contain" style={maxHeight ? { maxHeight } : undefined}>
      <table className="w-full border-collapse text-[13px]">
        <thead><tr>
          <th className={cx(th, 'w-10 pl-4 text-right')}>#</th>
          <th className={th}>{inLabel} <span className="font-normal text-faint">{before.names.length}</span></th>
          <th className="w-6 border-b border-line" aria-hidden="true" />
          <th className={cx(th, 'w-10 text-right')}>#</th>
          <th className={th}>{outLabel} <span className="font-normal text-faint">{after.names.length}</span></th>
          <th className={cx(th, 'w-14')}>位置</th>
          {extra && <th className={cx(th, 'pr-4')}>{extraLabel}</th>}
        </tr></thead>
        <tbody>
          {shown.map((r) => {
            const renamed = !!r.in && !!r.out && r.in.name !== r.out.name;
            return (
              <tr key={`${r.in?.index ?? ''}:${r.out?.index ?? ''}`} className={cx(!r.out && 'bg-[#fafbfc]')}>
                <td className={cx(td, 'pl-4 text-right font-mono text-[12px] text-faint')}>{r.in ? r.in.index + 1 : ''}</td>
                <td className={cx(td, 'font-mono whitespace-nowrap', !r.in ? 'text-faint italic' : !r.out ? 'text-muted line-through decoration-[#c9a8a4]' : renamed ? 'bg-[#fdf4f3] text-[#8f2a1f]' : 'text-ink-2')}>{r.in ? r.in.name : '（新增）'}</td>
                <td className={cx(td, 'text-center text-faint')} aria-hidden="true">→</td>
                <td className={cx(td, 'text-right font-mono text-[12px] text-faint')}>{r.out ? r.out.index + 1 : ''}</td>
                <td className={cx(td, 'font-mono whitespace-nowrap', !r.out ? 'text-muted italic' : renamed || !r.in ? 'bg-[#f2faf5] text-[#17633a]' : 'text-ink-2')}>{r.out ? r.out.name : '（移除）'}</td>
                <td className={cx(td, 'font-mono text-[12px] whitespace-nowrap')}>
                  {r.moved !== 0 && <span className="text-accent-ink" title={`在保留的节点中${r.moved > 0 ? '上移' : '下移'} ${Math.abs(r.moved)} 位`}>{r.moved > 0 ? '↑' : '↓'}{Math.abs(r.moved)}</span>}
                </td>
                {extra && <td className={cx(td, 'pr-4 font-mono text-[12px] whitespace-nowrap text-muted')}>{extra(r)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div> : <div className="px-4 pb-4"><Empty title={rows.length ? '没有任何节点发生变化' : '没有节点'} /></div>}
    <div ref={footer} className="border-t border-line-2 px-4 pt-3 pb-4 text-[12.5px] text-muted">
      显示 {shown.length} / {rows.length} 行 · 「位置」是在保留下来的节点中名次的变化{truncated && ' · 节点较多，预览只包含前 500 个'}
    </div>
  </>;
}

function StepChip({ index, tone, onClick, children }: { index: number; tone?: 'err'; onClick: () => void; children?: ReactNode }) {
  return <button type="button" onClick={onClick} title={`查看第 ${index + 1} 步`}
    className={cx('cursor-pointer rounded px-1.5 py-px font-mono text-[11.5px] hover:underline', tone === 'err' ? 'bg-err-soft text-err' : 'bg-accent-soft text-accent-ink')}>{children ?? index + 1}</button>;
}

export function PipelineEditor({ steps, onChange, preview, previewError, loading, inputLabel, layout = 'columns', title = '处理链' }: {
  steps: OperatorStep[];
  onChange: (s: OperatorStep[]) => void;
  preview?: PipelinePreview;
  previewError?: string;
  loading?: boolean;
  inputLabel?: string;
  /** 订阅源详情按上下顺序编辑与预览。 */
  layout?: 'columns' | 'stacked';
  /** 左栏标题，组合页用「组合自身的处理链」 */
  title?: string;
}) {
  // dnd-kit 需要稳定的 id：按位置生成，拖动时随数组一起移动
  const [ids, setIds] = useState<string[]>(() => steps.map((_, i) => `s${i}`));
  const [seq, setSeq] = useState(steps.length);
  const [selected, setSelected] = useState(OVERVIEW);
  const [mapOptions, setMapOptions] = useState<MapOptions>({ order: 'out', changedOnly: false });
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
  const autoDedupe = trace && trace.length > steps.length ? last : undefined;
  const mode = selected === OVERVIEW || selected > steps.length || (selected === steps.length && !autoDedupe) ? 'overview' : selected === steps.length ? 'auto' : 'step';
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

  const removedAt = useMemo(() => (preview ? removedAtStep(preview.inputNodes.length, preview.trace) : new Map<number, number>()), [preview]);
  const renamedAt = useMemo(() => (sides ? renamedAtSteps(sides[0]!.names, sides.slice(1)) : new Map<number, number[]>()), [sides]);
  const overviewStats = useMemo(() => (sides && finalSide ? mapStats(mapRows(sides[0]!, finalSide)) : undefined), [sides, finalSide]);
  const stepName = (k: number) => (k >= steps.length ? '自动去重' : OP_LABEL[steps[k]!.op]);

  const overviewRow = (
    <button type="button" onClick={() => setSelected(OVERVIEW)} aria-current={mode === 'overview' || undefined}
      className={cx('flex w-full cursor-pointer items-center gap-3 border-t border-line-2 py-3 pr-4 pl-4 text-left', mode === 'overview' ? 'bg-accent-soft' : 'bg-panel hover:bg-[#fafbfc]')}>
      <span aria-hidden="true" className={cx('grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md', mode === 'overview' ? 'bg-accent text-white' : 'bg-[#ebedf1] text-ink-2')}><ArrowLeftRight size={13} /></span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13.5px] font-medium">总览 · 原始 → 最终</span>
        <span className="truncate text-[12px] text-muted">原始节点与处理链跑完后的结果逐个对照</span>
      </span>
      {preview && <span className="shrink-0 font-mono text-[12.5px] text-ink-2">{preview.input} → {last ? last.after : preview.input}</span>}
    </button>
  );

  return (
    <div className={cx('flex gap-5', layout === 'stacked' ? 'flex-col' : 'flex-wrap items-start')}>
      <section aria-label={title} className={cx('min-w-0 rounded-[10px] border border-line bg-panel pt-4 pb-2', layout === 'columns' && 'flex-[1_1_360px]')}>
        <div className="flex items-center justify-between px-4 pb-3">
          <h2 className="m-0 text-[15px] font-semibold">{title}</h2>
          <span className="text-[12.5px] text-muted">拖动排序 · {inputLabel ?? `输入 ${preview?.input ?? '—'} 个节点`}</span>
        </div>
        {overviewRow}
        <SortableList items={steps.map((s, i) => ({ step: s, id: keys[i]! }))} getKey={(item) => item.id}
          onReorder={(items, { to }) => {
            setIds(items.map((item) => item.id));
            onChange(items.map((item) => item.step));
            setSelected(to);
          }}
          renderItem={({ step: s }, i, handle) => (
            <StepRow handle={handle} index={i} step={s} selected={mode === 'step' && i === selected} onSelect={() => setSelected(i)} {...(trace?.[i] ? { trace: trace[i] } : {})} />
          )} />
        <button type="button" disabled={!autoDedupe} onClick={() => setSelected(steps.length)} aria-current={mode === 'auto' || undefined}
          className={cx('flex w-full items-center gap-3 border-t border-line-2 px-4 py-3 text-left', mode === 'auto' ? 'bg-accent-soft' : 'bg-[#fafbfc]', autoDedupe && 'cursor-pointer')}>
          <span aria-hidden="true" className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md bg-[#ebedf1] font-mono text-[12px] text-faint">✓</span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[13.5px] font-medium text-ink-2">去重 · 加序号 <span className="text-[12px] font-normal text-muted">自动兜底，不可移除</span></span>
            <span className="font-mono text-[12px] text-muted">{autoDedupe?.renamed.length ? `${autoDedupe.renamed.length} 个重名节点追加了序号` : '同名节点追加 2、3…'}</span>
          </span>
          {last && <span className="font-mono text-[12.5px] text-ink-2">{last.after}{autoDedupe && <span className="text-ok"> ~{autoDedupe.renamed.length}</span>}</span>}
        </button>
        <AddMenu onAdd={add} />
      </section>

      <section aria-label="编辑与预览" className={cx('min-w-0 rounded-[10px] border border-line bg-panel', layout === 'columns' && 'flex-[999_1_540px]')}>
        {mode === 'overview' && <>
          <div className="flex flex-col gap-2.5 px-4 pt-4 pb-3">
            <div className="flex flex-col gap-0.5">
              <h2 className="m-0 text-[15px] font-semibold">总览 · 原始 → 最终</h2>
              <span className="text-[12.5px] text-muted">{steps.length ? '左边是解析出的原始节点，右边是所有步骤和自动去重跑完后的输出。点「经过的步骤」里的序号跳到那一步调试。' : '还没有处理步骤，节点会原样输出。从「添加处理器」开始，每加一步都能看到它的效果。'}</span>
            </div>
            {preview && overviewStats && <div className="flex flex-wrap gap-1.5">
              <Badge>原始 {preview.input}</Badge>
              <Badge>最终 {last ? last.after : preview.input}</Badge>
              {overviewStats.renamed > 0 && <Badge tone="ok">改名 {overviewStats.renamed}</Badge>}
              {overviewStats.removed > 0 && <Badge tone="err">移除 {overviewStats.removed}</Badge>}
              {overviewStats.added > 0 && <Badge tone="ok">新增 {overviewStats.added}</Badge>}
              {overviewStats.moved > 0 && <Badge>调整顺序 {overviewStats.moved}</Badge>}
            </div>}
            {loading && <span className="text-[12.5px] text-muted">预览中…</span>}
          </div>
          {previewError && <div role="alert" className="mx-4 mb-3 rounded-lg bg-err-soft px-3 py-2 text-[13px] text-err">{previewError}</div>}
          {before && after && <MappingView before={before} after={after} inLabel="原始节点" outLabel="最终输出" options={mapOptions} onOptions={setMapOptions} truncated={truncated}
            extraLabel="经过的步骤" extra={(r) => {
              if (r.origin === null) return null;
              const gone = removedAt.get(r.origin);
              const renames = renamedAt.get(r.origin) ?? [];
              return <span className="flex flex-wrap items-center gap-1">
                {renames.map((k) => <StepChip key={k} index={k} onClick={() => setSelected(k)}>{k >= steps.length ? '去重' : k + 1}</StepChip>)}
                {gone !== undefined && <StepChip index={gone} tone="err" onClick={() => setSelected(gone)}>第 {gone + 1} 步 {stepName(gone)} 移除</StepChip>}
              </span>;
            }} />}
          {!preview && !previewError && <div className="px-4 pb-4 text-[13px] text-muted">{loading ? '预览中…' : '保存后可预览'}</div>}
        </>}

        {mode === 'auto' && autoDedupe && <>
          <div className="flex flex-col gap-0.5 px-4 pt-4 pb-3">
            <h2 className="m-0 text-[15px] font-semibold">去重 · 加序号（自动兜底）</h2>
            <span className="text-[12.5px] text-muted">所有步骤跑完后，同名节点从第二个起追加 2、3…，保证名称唯一。这一步不可移除。</span>
          </div>
          <div className="border-t border-line-2 px-4 pt-3 pb-3"><h3 className="m-0 text-[13.5px] font-semibold">输入 → 输出 <span className="font-normal text-muted">· {resultText(autoDedupe)}</span></h3></div>
          {before && after && <MappingView before={before} after={after} inLabel="输入" outLabel="输出" options={mapOptions} onOptions={setMapOptions} truncated={truncated} />}
        </>}

        {mode === 'step' && step && <>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 pb-3">
            <div className="flex flex-col gap-0.5">
              <h2 className="m-0 text-[15px] font-semibold">第 {selected + 1} 步 · {OP_LABEL[step.op]}</h2>
              <span className="text-[12.5px] text-muted">{OP_DESC[step.op]}</span>
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
            <h3 className="m-0 text-[13.5px] font-semibold">这一步的输入 → 输出 <span className="font-normal text-muted">· {loading ? '预览中…' : cur ? resultText(cur) : '保存后可预览'}</span></h3>
          </div>
          {previewError && <div role="alert" className="mx-4 mb-3 rounded-lg bg-err-soft px-3 py-2 text-[13px] text-err">{previewError}</div>}
          {cur && before && after && <MappingView before={before} after={after} inLabel={selected === 0 ? '输入（原始节点）' : `输入（第 ${selected} 步之后）`} outLabel="输出"
            options={mapOptions} onOptions={setMapOptions} truncated={truncated}
            extraLabel="命中" extra={(r) => (r.in && (!r.out || r.in.name !== r.out.name || r.moved !== 0) ? rowHit(step, r.in.name) : null)} />}
        </>}

        {preview && preview.failures.length > 0 && (
          <details className="border-t border-line-2 px-4 py-3 text-[12.5px]">
            <summary className="cursor-pointer text-accent">{preview.failures.length} 个节点解析失败</summary>
            <ul className="mt-2 flex flex-col gap-1 pl-4">{preview.failures.map((f, i) => <li key={i}><span className="font-mono">{f.line.slice(0, 80)}</span> — {f.reason}</li>)}</ul>
          </details>
        )}
      </section>
    </div>
  );
}
