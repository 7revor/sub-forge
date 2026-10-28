// 处理链编辑器（SRC-06）：左侧步骤列表（拖拽排序、启用开关、删除），选中步骤在下方编辑；
// 右侧是"这一步之后"的逐步预览：与上一步的改名 / 移除差异，以及节点列表。

import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { OperatorStep } from '@sub-forge/core';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { PipelinePreview } from '../api.ts';
import { Badge, Button, Card, Empty, Field, Input, Segmented, Select, Switch, Textarea, cx, td, th } from './ui.tsx';

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
    case 'filter.regex': return `${s.keep ? '保留' : '剔除'} ${s.patterns.join(' | ')}`;
    case 'filter.type': return `${s.keep ? '保留' : '剔除'} ${s.types.join(', ')}`;
    case 'filter.useless': return s.patterns?.length ? s.patterns.join(' | ') : '默认关键词（剩余流量、到期、官网…）';
    case 'rename.regex': return `${s.rules.length} 条规则 · 正则链`;
    case 'rename.delete': return s.patterns.join(' | ');
    case 'rename.affix': return `${s.prefix ?? ''}…${s.suffix ?? ''}`;
    case 'flag': return s.mode === 'add' ? '按名称识别地区，前置旗帜' : '移除旗帜';
    case 'sort.name': return s.order === 'asc' ? '升序' : '降序';
    case 'sort.regex': return s.patterns.join(' > ');
    case 'dedupe': return `${s.by === 'key' ? '按节点身份' : '按名称'} · ${s.strategy === 'drop' ? '删除重复' : '追加序号'}`;
    case 'set': return Object.entries(s.fields).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ');
    case 'script': return '自定义脚本';
  }
}

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

function StepForm({ step, onChange }: { step: OperatorStep; onChange: (s: OperatorStep) => void }) {
  const [setText, setSetText] = useState(step.op === 'set' ? JSON.stringify(step.fields, null, 2) : '');
  const [setErr, setSetErr] = useState('');
  switch (step.op) {
    case 'filter.regex':
    case 'filter.type':
      return (
        <div className="flex flex-col gap-3">
          <Segmented label="保留或剔除" value={step.keep ? 'keep' : 'drop'} options={[{ value: 'drop', label: '剔除命中' }, { value: 'keep', label: '只保留命中' }]} onChange={(v) => onChange({ ...step, keep: v === 'keep' })} />
          {step.op === 'filter.regex'
            ? <Field label="正则（每行一条，命中任一条即算命中）" hint="支持 (?i) 前缀忽略大小写">{(id) => <Textarea id={id} rows={3} className="font-mono" value={step.patterns.join('\n')} onChange={(e) => onChange({ ...step, patterns: e.target.value.split('\n') })} onBlur={(e) => onChange({ ...step, patterns: lines(e.target.value) })} />}</Field>
            : <Field label="协议类型（逗号分隔）">{(id) => <Input id={id} className="font-mono" value={step.types.join(', ')} onChange={(e) => onChange({ ...step, types: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />}</Field>}
        </div>
      );
    case 'filter.useless':
    case 'rename.delete':
    case 'sort.regex': {
      const value = step.op === 'filter.useless' ? step.patterns ?? [] : step.patterns;
      const label = step.op === 'filter.useless' ? '关键词正则（每行一条，留空使用默认）' : step.op === 'sort.regex' ? '优先级（每行一条，先命中的排前面）' : '要删除的部分（每行一条正则）';
      return <Field label={label}>{(id) => <Textarea id={id} rows={4} className="font-mono" value={value.join('\n')} onChange={(e) => onChange({ ...step, patterns: e.target.value.split('\n') } as OperatorStep)} onBlur={(e) => onChange({ ...step, patterns: lines(e.target.value) } as OperatorStep)} />}</Field>;
    }
    case 'rename.regex':
      return (
        <div className="flex flex-col gap-2">
          <span className="text-[12.5px] font-medium text-muted">正则链（按顺序执行，替换支持 $1）</span>
          {step.rules.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-5 font-mono text-[12px] text-muted">{i + 1}</span>
              <Input aria-label={`规则 ${i + 1} 正则`} className="font-mono" placeholder="^香港\s*(\d+).*$" value={r.pattern} onChange={(e) => onChange({ ...step, rules: step.rules.map((x, j) => (j === i ? { ...x, pattern: e.target.value } : x)) })} />
              <span aria-hidden="true" className="text-faint">→</span>
              <Input aria-label={`规则 ${i + 1} 替换为`} className="font-mono" placeholder="HK-$1" value={r.replace} onChange={(e) => onChange({ ...step, rules: step.rules.map((x, j) => (j === i ? { ...x, replace: e.target.value } : x)) })} />
              <Button variant="ghost" size="sm" aria-label={`删除规则 ${i + 1}`} onClick={() => onChange({ ...step, rules: step.rules.filter((_, j) => j !== i) })}><Trash2 size={14} /></Button>
            </div>
          ))}
          <div><Button size="sm" onClick={() => onChange({ ...step, rules: [...step.rules, { pattern: '', replace: '' }] })}><Plus size={14} />添加规则</Button></div>
        </div>
      );
    case 'rename.affix':
      return (
        <div className="grid grid-cols-2 gap-3">
          <Field label="前缀">{(id) => <Input id={id} value={step.prefix ?? ''} onChange={(e) => onChange({ ...step, prefix: e.target.value })} />}</Field>
          <Field label="后缀">{(id) => <Input id={id} value={step.suffix ?? ''} onChange={(e) => onChange({ ...step, suffix: e.target.value })} />}</Field>
        </div>
      );
    case 'flag':
      return <Segmented label="旗帜" value={step.mode} options={[{ value: 'add', label: '添加旗帜' }, { value: 'remove', label: '移除旗帜' }]} onChange={(mode) => onChange({ ...step, mode })} />;
    case 'sort.name':
      return <Segmented label="排序" value={step.order} options={[{ value: 'asc', label: '升序' }, { value: 'desc', label: '降序' }]} onChange={(order) => onChange({ ...step, order })} />;
    case 'dedupe':
      return (
        <div className="flex flex-wrap gap-3">
          <Segmented label="判重依据" value={step.by ?? 'name'} options={[{ value: 'name', label: '按名称' }, { value: 'key', label: '按节点身份' }]} onChange={(by) => onChange({ ...step, by })} />
          <Segmented label="处理方式" value={step.strategy} options={[{ value: 'suffix', label: '追加序号' }, { value: 'drop', label: '删除重复' }]} onChange={(strategy) => onChange({ ...step, strategy })} />
        </div>
      );
    case 'set':
      return (
        <Field label="字段（JSON，不能改 name / type / server / port）" hint={setErr || '如 {"udp": true, "skip-cert-verify": true}'}>
          {(id) => <Textarea id={id} rows={4} className="font-mono" value={setText} onChange={(e) => {
            setSetText(e.target.value);
            try {
              const v = JSON.parse(e.target.value) as unknown;
              if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('需要 JSON 对象');
              setSetErr('');
              onChange({ ...step, fields: v as Record<string, unknown> });
            } catch (err) { setSetErr(`JSON 无效：${(err as Error).message}`); }
          }} />}
        </Field>
      );
    case 'script':
      return <Field label="脚本 (nodes, ctx) => nodes" hint="在服务端沙箱中执行（P1，尚未启用）">{(id) => <Textarea id={id} rows={6} className="font-mono" value={step.code} onChange={(e) => onChange({ ...step, code: e.target.value })} />}</Field>;
  }
}

function StepRow({ id, index, step, selected, onSelect, onToggle, onRemove, trace }: {
  id: string; index: number; step: OperatorStep; selected: boolean;
  onSelect: () => void; onToggle: (v: boolean) => void; onRemove: () => void;
  trace?: { before: number; after: number; error?: string };
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const enabled = step.enabled !== false;
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cx('flex items-center gap-2 border-t border-line-2 px-3 py-2', selected ? 'bg-accent-soft' : 'bg-panel', isDragging && 'relative z-10 shadow-md')}>
      <button type="button" aria-label={`拖动第 ${index + 1} 步`} className="grid h-8 w-6 cursor-grab place-items-center text-faint" {...attributes} {...listeners}><GripVertical size={16} /></button>
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left">
        <span className={cx('grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md font-mono text-[12px]', selected ? 'bg-accent text-white' : 'bg-[#ebedf1] text-ink-2')}>{index + 1}</span>
        <span className={cx('flex min-w-0 flex-col gap-0.5', !enabled && 'opacity-50')}>
          <span className="text-[13.5px] font-medium">{OP_LABEL[step.op]}</span>
          <span className="truncate font-mono text-[12px] text-muted">{stepSummary(step)}</span>
        </span>
      </button>
      {trace && (trace.error
        ? <Badge tone="err">失败</Badge>
        : <span className="shrink-0 font-mono text-[12px] text-ink-2">{trace.after}{trace.after !== trace.before && <span className={trace.after < trace.before ? 'text-err' : 'text-ok'}> {trace.after - trace.before > 0 ? '+' : ''}{trace.after - trace.before}</span>}</span>)}
      <Switch label={`启用第 ${index + 1} 步`} checked={enabled} onChange={onToggle} />
      <Button variant="ghost" size="sm" aria-label={`删除第 ${index + 1} 步`} onClick={onRemove}><Trash2 size={14} /></Button>
    </li>
  );
}

export function PipelineEditor({ steps, onChange, preview, previewError, loading, inputLabel }: {
  steps: OperatorStep[];
  onChange: (s: OperatorStep[]) => void;
  preview?: PipelinePreview;
  previewError?: string;
  loading?: boolean;
  inputLabel?: string;
}) {
  // dnd-kit 需要稳定的 id：按位置生成，拖动时随数组一起移动
  const [ids, setIds] = useState<string[]>(() => steps.map((_, i) => `s${i}`));
  const [seq, setSeq] = useState(steps.length);
  const [selected, setSelected] = useState(0);
  const [adding, setAdding] = useState<OperatorStep['op']>('rename.regex');
  const keys = ids.length === steps.length ? ids : steps.map((_, i) => ids[i] ?? `x${i}`);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = keys.indexOf(String(e.active.id));
    const to = keys.indexOf(String(e.over.id));
    setIds(arrayMove(keys, from, to));
    onChange(arrayMove(steps, from, to));
    setSelected(to);
  };
  const add = () => {
    onChange([...steps, NEW_STEP[adding]()]);
    setIds([...keys, `s${seq}`]);
    setSeq(seq + 1);
    setSelected(steps.length);
  };
  const remove = (i: number) => {
    onChange(steps.filter((_, j) => j !== i));
    setIds(keys.filter((_, j) => j !== i));
    setSelected(Math.max(0, Math.min(selected, steps.length - 2)));
  };

  const trace = preview?.trace;
  // 选中的步骤对应的 trace；末尾自动去重兜底会多出一条
  const cur = trace?.[selected];
  const last = trace?.at(-1);
  const autoDedupe = trace && trace.length > steps.length ? last : undefined;
  const step = steps[selected];
  const diffRows = useMemo(() => cur ? [...cur.renamed.map((r) => ({ ...r, kind: 'rename' as const })), ...cur.removed.map((n) => ({ from: n, to: '', kind: 'remove' as const }))] : [], [cur]);

  return (
    <div className="flex flex-wrap items-start gap-5">
      <Card title="处理链" className="min-w-0 flex-[1_1_380px]" bodyClass="pb-2"
        actions={<span className="text-[12.5px] text-muted">{inputLabel ?? `输入 ${preview?.input ?? '—'} 个节点`}</span>}>
        {steps.length === 0 && <div className="px-1 pb-3"><Empty>还没有处理步骤，节点会原样输出。</Empty></div>}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={keys} strategy={verticalListSortingStrategy}>
            <ol className="-mx-4 m-0 list-none p-0">
              {steps.map((s, i) => (
                <StepRow key={keys[i]} id={keys[i]!} index={i} step={s} selected={i === selected} onSelect={() => setSelected(i)}
                  onToggle={(v) => onChange(steps.map((x, j) => (j === i ? { ...x, enabled: v } : x)))}
                  onRemove={() => remove(i)} {...(trace?.[i] ? { trace: trace[i] } : {})} />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
        {autoDedupe && (
          <div className="-mx-4 flex items-center gap-3 border-t border-line-2 bg-ground px-4 py-2.5 text-[12.5px] text-muted">
            <span className="font-medium text-ink-2">去重 · 加序号</span>自动兜底：{autoDedupe.renamed.length} 个重名节点追加了序号
          </div>
        )}
        <div className="-mx-4 flex gap-2 border-t border-line-2 px-4 pt-3">
          <Select aria-label="处理器类型" value={adding} onChange={(e) => setAdding(e.target.value as OperatorStep['op'])} className="h-10">
            {Object.entries(OP_LABEL).map(([op, label]) => <option key={op} value={op}>{label}</option>)}
          </Select>
          <Button onClick={add}><Plus size={16} />添加</Button>
        </div>
        {step && (
          <div className="-mx-4 mt-3 flex flex-col gap-3 border-t border-line px-4 pt-3">
            <span className="text-[13px] font-semibold">编辑第 {selected + 1} 步 · {OP_LABEL[step.op]}</span>
            <StepForm key={`${keys[selected]}-${step.op}`} step={step} onChange={(s) => onChange(steps.map((x, j) => (j === selected ? { ...s, ...(x.enabled === false ? { enabled: false } : {}) } : x)))} />
          </div>
        )}
      </Card>

      <Card className="min-w-0 flex-[999_1_480px]" bodyClass="pb-4"
        title={<div className="flex flex-col gap-0.5">
          <h2 className="m-0 text-[15px] font-semibold">{cur ? `第 ${selected + 1} 步之后 · ${OP_LABEL[step?.op ?? 'flag']}` : '逐步预览'}</h2>
          <span className="text-[12.5px] text-muted">{loading ? '预览中…' : cur ? (cur.error ? `这一步失败，已跳过：${cur.error}` : `${cur.before} → ${cur.after} 个节点，改名 ${cur.renamed.length}，移除 ${cur.removed.length}`) : (steps.length ? '保存后可预览每一步的结果' : '添加处理步骤后可以逐步预览')}</span>
        </div>}>
        {previewError && <div className="mb-3 rounded-lg bg-err-soft px-3 py-2 text-[13px] text-err">{previewError}</div>}
        {cur && (
          <div className="flex flex-col gap-4">
            {diffRows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[13px]">
                  <thead><tr><th className={th}>上一步</th><th className={th} aria-hidden="true" /><th className={th}>这一步之后</th></tr></thead>
                  <tbody>
                    {diffRows.slice(0, 200).map((d, i) => (
                      <tr key={i}>
                        <td className={`${td} bg-[#fdf4f3] font-mono text-[#8f2a1f]`}>{d.from}</td>
                        <td className={`${td} text-center text-faint`} aria-hidden="true">→</td>
                        <td className={`${td} font-mono ${d.kind === 'remove' ? 'text-muted italic' : 'bg-[#f2faf5] text-[#17633a]'}`}>{d.kind === 'remove' ? '（移除）' : d.to}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-semibold">节点（{cur.nodes.length}{cur.truncated ? '+' : ''}）</span>
              <div className="flex flex-wrap gap-1.5">
                {cur.nodes.map((n, i) => <span key={i} title={`${n.type} ${n.server}:${n.port}`} className="rounded-md border border-line bg-ground px-2 py-1 font-mono text-[12px]">{n.name}</span>)}
              </div>
            </div>
          </div>
        )}
        {preview && preview.failures.length > 0 && (
          <details className="mt-4 text-[12.5px]">
            <summary className="cursor-pointer text-accent">{preview.failures.length} 个节点解析失败</summary>
            <ul className="mt-2 flex flex-col gap-1 pl-4">{preview.failures.map((f, i) => <li key={i}><span className="font-mono">{f.line.slice(0, 80)}</span> — {f.reason}</li>)}</ul>
          </details>
        )}
      </Card>
    </div>
  );
}
