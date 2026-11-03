import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuItem } from './ui/dropdown-menu.tsx';
// 处理链编辑器（SRC-06，设计稿「订阅源 · 编辑处理步骤」「处理器参数表单」）：
// 左侧步骤列表（拖拽排序、节点数变化、添加处理器菜单）；自动去重仅计入最终输出。
// 右侧选中步骤的参数 + 启用开关 / 删除，下方分别展示这一步的输入列表与输出列表；
// 未选择步骤时展示原始节点与最终结果的总览；点击编辑器之外取消选择。

import type { OperatorStep } from '@sub-forge/core';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { mapRows, mapStats } from './pipelineMap.ts';
import { PipelineStepForm } from './PipelineStepForm.tsx';
import { SortableList } from './SortableList.tsx';
import type { PipelinePreview, TraceStep } from '../api.ts';
import { Badge, Button, Empty, ErrorAlert, Switch, cx } from './ui.tsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table.tsx';

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
    case 'set': return (s.types ? `仅 ${s.types.join('、')}：` : '') + Object.entries(s.fields).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ');
    case 'script': return '自定义脚本';
  }
}

function AddMenu({ onAdd }: { onAdd: (op: OperatorStep['op']) => void }) {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button size="sm"><Plus size={14} />添加步骤</Button></DropdownMenuTrigger>
    <DropdownMenuContent aria-label="选择处理器" align="start" className="w-64 max-w-[calc(100vw-32px)]">
      {OP_GROUPS.map(group => <DropdownMenuGroup key={group.title} className="border-t border-border py-2 first:border-t-0">
        <DropdownMenuLabel className="px-2 pb-1 text-xs font-medium text-muted-foreground">{group.title}</DropdownMenuLabel>
        {group.ops.map(op => <DropdownMenuItem key={op} className="pl-5 text-sm" onSelect={() => onAdd(op)}>{OP_LABEL[op]}</DropdownMenuItem>)}
      </DropdownMenuGroup>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}

function StepCount({ trace }: { trace?: TraceStep }) {
  if (!trace) return null;
  if (trace.error) return <Badge tone="err">失败</Badge>;
  const delta = trace.after - trace.before;
  return <span className="shrink-0 font-mono text-sm text-foreground">{trace.after}
    {delta !== 0 && <span className={delta < 0 ? 'text-destructive' : 'text-ok'}> {delta > 0 ? '+' : '−'}{Math.abs(delta)}</span>}
    {delta === 0 && trace.renamed.length > 0 && <span className="text-ok"> ~{trace.renamed.length}</span>}
  </span>;
}

function StepRow({ handle, index, step, selected, onSelect, trace }: {
  handle: ReactNode; index: number; step: OperatorStep; selected: boolean; onSelect: () => void; trace?: TraceStep;
}) {
  const enabled = step.enabled !== false;
  return (
    <div className={cx('flex min-h-[52px] items-center gap-1 rounded-lg border border-border pl-2', selected ? 'bg-primary/10' : 'bg-card')}>
      {handle}
      <button type="button" onClick={onSelect} aria-current={selected || undefined} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-2 pr-4 pl-1 text-left">
        <span className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-md font-mono text-xs', selected ? 'bg-primary text-white' : 'bg-primary/10 text-primary')}>{index + 1}</span>
        <span className={cx('flex min-w-0 flex-1 flex-col gap-0.5', !enabled && 'opacity-50')}>
          <span className="text-sm font-medium">{OP_LABEL[step.op]}{!enabled && <span className="ml-1.5 text-xs font-normal text-muted-foreground">已停用</span>}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">{stepSummary(step)}</span>
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
/** 映射预览是紧凑表格，首尾列不需要卡片内边距。 */
const mappingCell = 'px-3 py-2 first:pl-3 last:pr-3';
/** 两侧独立排列与滚动，不按节点来源配对，也不补齐缺失行。 */
function InputOutputView({ before, after, inLabel, outLabel, truncated }: {
  before: Side; after: Side; inLabel: string; outLabel: string; truncated?: boolean;
}) {
  return <>
    <div className="pipeline-mapping-scroll mx-4 grid grid-cols-2 gap-4">
      {[{ side: before, label: inLabel }, { side: after, label: outLabel }].map(({ side, label }, column) => (
        <section key={column} aria-label={label} className="min-h-0 min-w-0 overflow-auto overscroll-contain">
          <Table containerClassName="overflow-visible">
            <TableHeader className="sticky top-0 z-[1] bg-card">
              <TableRow>
                <TableHead className={cx(mappingCell, 'h-auto w-10 text-right text-xs text-muted-foreground')}>#</TableHead>
                <TableHead className={cx(mappingCell, 'h-auto text-xs text-muted-foreground')}>{label} <span className="font-normal text-muted-foreground">{side.names.length}</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {side.names.map((name, index) => <TableRow key={index}>
                <TableCell className={cx(mappingCell, 'text-right font-mono text-xs text-muted-foreground')}>{index + 1}</TableCell>
                <TableCell className={cx(mappingCell, 'font-mono whitespace-nowrap text-foreground')}>{name}</TableCell>
              </TableRow>)}
            </TableBody>
          </Table>
          {!side.names.length && <div className="py-3"><Empty title="没有节点" /></div>}
        </section>
      ))}
    </div>
    <div className="border-t border-border px-4 pt-3 pb-4 text-sm text-muted-foreground">
      输入 {before.names.length} 个 · 输出 {after.names.length} 个{truncated && ' · 节点较多，预览只包含前 500 个'}
    </div>
  </>;
}

export function PipelineEditor({ compactOverview = false, steps, onChange, preview, previewError, loading, inputLabel, title = '处理链' }: {
  compactOverview?: boolean;
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
  const pointerStartedInside = useRef(false);
  useEffect(() => {
    const resetPointer = () => { pointerStartedInside.current = false; };
    const clearSelection = (event: MouseEvent) => {
      // 菜单在 pointerdown 打开后，click 可能落到浮层；仍按按下位置判断。
      // 等 click 再取消选择，让参数输入框先完成 blur 提交。
      if (!pointerStartedInside.current && !internalClicks.current.has(event)) setSelected(OVERVIEW);
      resetPointer();
    };
    document.addEventListener('pointerdown', resetPointer, true);
    document.addEventListener('click', clearSelection);
    return () => {
      document.removeEventListener('pointerdown', resetPointer, true);
      document.removeEventListener('click', clearSelection);
    };
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
    <div className={cx("pipeline-workspace", compactOverview && mode === 'overview' && 'pipeline-compact')} onPointerDownCapture={() => { pointerStartedInside.current = true; }} onClickCapture={(event) => internalClicks.current.add(event.nativeEvent)}>
      <ErrorAlert error={previewError} />
      <section aria-label={title} className="pipeline-steps rounded-xl border bg-card shadow-sm pt-4 pb-2">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 pb-3">
          <h2 className="m-0 text-base font-semibold">{title}</h2>
          <AddMenu onAdd={add} />
          <span className="w-full text-sm text-muted-foreground">{inputLabel ?? `输入 ${preview?.input ?? '—'} 个节点`}</span>
        </div>
        <div className="pipeline-step-scroll">
        {!steps.length && <div className="px-4 pb-2"><Empty variant="card" title="暂无处理器" /></div>}
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
        <div className="flex items-center justify-between px-5 pt-3 pb-2 text-sm"><span className="font-medium">最终 {last?.after ?? preview?.input ?? '—'} 个节点</span><Button size="sm" variant="ghost" onClick={() => setSelected(-1)}>查看全部</Button></div>
      </section>

      {!(compactOverview && mode === 'overview') && <section aria-label="编辑与预览" className="pipeline-preview rounded-xl border bg-card shadow-sm">
        {mode === 'overview' && <>
          <div className="flex flex-col gap-2.5 px-4 pt-4 pb-3">
            <div className="flex flex-col gap-0.5">
              <h2 className="m-0 text-base font-semibold">总览 · 原始 → 最终</h2>
            </div>
            {preview && overviewStats && <div className="flex flex-wrap gap-1.5">
              <Badge>原始 {preview.input}</Badge>
              <Badge>最终 {last ? last.after : preview.input}</Badge>
              {overviewStats.renamed > 0 && <Badge tone="ok">改名 {overviewStats.renamed}</Badge>}
              {overviewStats.removed > 0 && <Badge tone="err">移除 {overviewStats.removed}</Badge>}
              {overviewStats.added > 0 && <Badge tone="ok">新增 {overviewStats.added}</Badge>}
              {overviewStats.moved > 0 && <Badge>调整顺序 {overviewStats.moved}</Badge>}
            </div>}
            {loading && <span className="text-sm text-muted-foreground">预览中…</span>}
          </div>
          {before && after && <InputOutputView before={before} after={after} inLabel="输入" outLabel="输出" truncated={truncated} />}
          {!preview && !previewError && !loading && <div className="px-4 pb-4 text-sm text-muted-foreground">保存后可预览</div>}
        </>}

        {mode === 'step' && step && <>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 pb-3">
            <div className="flex flex-col gap-0.5">
              <h2 className="m-0 text-base font-semibold">第 {selected + 1} 步 · {OP_LABEL[step.op]}</h2>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="flex items-center gap-2 text-sm text-foreground">
                <Switch label="启用这一步" checked={enabled} onChange={(v) => onChange(steps.map((x, j) => (j === selected ? { ...x, enabled: v } : x)))} />启用
              </span>
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => remove(selected)}><Trash2 size={14} />删除步骤</Button>
            </div>
          </div>
          {cur?.error && <div role="alert" className="mx-4 mb-3 rounded-lg border border-destructive px-3 py-2 text-sm text-destructive">这一步失败，已跳过：{cur.error}</div>}
          <div className="pipeline-parameters mx-4 mb-4 min-w-0">
            <PipelineStepForm key={`${keys[selected]}-${step.op}`} step={step} names={before?.names}
              onChange={(s) => onChange(steps.map((x, j) => (j === selected ? { ...s, ...(x.enabled === false ? { enabled: false } : {}) } : x)))} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 pt-3 pb-3">
            <h3 className="m-0 text-sm font-semibold">这一步的输入 → 输出 <span className="font-normal text-muted-foreground">· {loading ? '预览中…' : cur ? resultText(cur) : '保存后可预览'}</span></h3>
          </div>
          {cur && before && after && <InputOutputView before={before} after={after} inLabel="输入" outLabel="输出" truncated={truncated} />}
        </>}

        {preview && preview.failures.length > 0 && (
          <details className="border-t border-border px-4 py-3 text-sm">
            <summary className="cursor-pointer text-primary">{preview.failures.length} 个节点解析失败</summary>
            <ul className="mt-2 flex flex-col gap-1 pl-4">{preview.failures.map((f, i) => <li key={i}><span className="font-mono">{f.line.slice(0, 80)}</span> — {f.reason}</li>)}</ul>
          </details>
        )}
      </section>}
    </div>
  );
}
