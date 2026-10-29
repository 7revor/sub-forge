import { useQuery } from '@tanstack/react-query';
import type { Client, Platform, RuleConversion, RuleSetDelivery } from '@sub-forge/core';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import type { RuleSetDoc } from '../hooks.ts';
import { useDebouncedValue } from '../hooks/useDebouncedValue.ts';
import type { useRulesetSources } from '../hooks/useRulesetSources.ts';
import { CodePreview } from './CodePreview.tsx';
import { Badge, Button, FieldError, cx } from './ui.tsx';

type Result = RuleConversion & { delivery: RuleSetDelivery; passthrough: boolean };
const TARGETS: { key: string; client: Client; platform?: Platform; label: string }[] = [
  { key: 'mihomo', client: 'mihomo', label: 'mihomo' },
  { key: 'mihomo-android', client: 'mihomo', platform: 'android', label: 'mihomo Android' },
  { key: 'surge-macos', client: 'surge', platform: 'macos', label: 'Surge macOS' },
  { key: 'surge-ios', client: 'surge', platform: 'ios', label: 'Surge iOS' },
  { key: 'stash-macos', client: 'stash', platform: 'macos', label: 'Stash macOS' },
  { key: 'stash-ios', client: 'stash', platform: 'ios', label: 'Stash iOS' },
];
/** 客户端选择自控；转换由服务器完成。整个更新周期保持文本区域挂载。 */
export function RulesetPreview({ inputs, ready, sourceId, overrides, sourceError, sourceNames, sourceReading, onRefreshSources }: {
  inputs: ReturnType<typeof useRulesetSources>['inputs']; ready: boolean; sourceId?: string;
  overrides: RuleSetDoc['overrides']; sourceError?: unknown; sourceNames: Record<string, string>; sourceReading: boolean; onRefreshSources: () => Promise<void>;
}) {
  const [target, setTarget] = useState('mihomo');
  const t = TARGETS.find(x => x.key === target)!;
  const process = useDebouncedValue({ overrides }, 300);
  const body = { inputs, sourceId, ...process, client: t.client, platform: t.platform };
  const settled = JSON.stringify(process) === JSON.stringify({ overrides });
  const preview = useQuery({
    queryKey: ['rule-conversion', body], enabled: ready && settled, retry: false, staleTime: 60_000,
    queryFn: () => api<Result>('POST', '/rules/convert', body),
    placeholderData: (previous, query) => {
      // 切换来源不能把旧来源内容当作新来源展示；客户端切换允许保留并明确标注旧结果。
      const previousBody = query?.queryKey[1] as typeof body | undefined;
      return previousBody?.sourceId === sourceId ? previous : undefined;
    },
  });
  const last = useRef<{ sourceId?: string; target: string; result: Result } | undefined>(undefined);
  useEffect(() => { if (preview.data && !preview.isPlaceholderData) last.current = { sourceId, target, result: preview.data }; }, [preview.data, preview.isPlaceholderData, sourceId, target]);
  const pending = !ready || !settled || preview.isFetching;
  const result = preview.data ?? (last.current?.sourceId === sourceId ? last.current?.result : undefined);
  const old = pending || preview.isPlaceholderData || !!preview.error || !!sourceError;
  const stats = result?.stats;
  const previousLabel = TARGETS.find(x => x.key === last.current?.target)?.label;
  const diagnostic = result?.diagnostics.filter(d => ['client', 'degraded', 'override'].includes(d.kind)) ?? [];
  const status = sourceError && !sourceReading ? result ? '来源读取失败，暂显示上次结果。' : '来源读取失败，尚无可用预览。'
    : pending ? result ? `正在更新，暂显示上次${previousLabel ? ` ${previousLabel}` : ''}结果…` : '正在加载规则…'
    : preview.error ? `更新失败，暂显示上次${previousLabel ? ` ${previousLabel} ` : ''}结果。`
    : result?.delivery.mode === 'unsupported' ? result.delivery.reason
    : result?.passthrough ? '二进制来源由客户端读取，无法展示文本。' : null;
  return <div className="flex flex-col gap-3" aria-label="规则转换预览">
    <div role="group" aria-label="客户端与平台" className="flex flex-wrap gap-1.5">
      {TARGETS.map(x => <button key={x.key} type="button" aria-pressed={x.key === target} onClick={() => setTarget(x.key)}
        className={cx('h-[34px] shrink-0 cursor-pointer rounded-full border whitespace-nowrap font-medium px-3 text-[12.5px]', x.key === target ? 'border-accent bg-[#f5f8ff] text-accent-ink' : 'border-[#d5d9e0] bg-panel text-ink hover:bg-ground')}>{x.label}</button>)}
    </div>
    <CodePreview label="规则输出" text={result?.lines.join('\n') ?? ''} loading={old} className="shrink-0" bodyClassName="h-[420px]" lineNumbers />
    <div className="min-h-10 text-[12.5px] text-ink-2" aria-label="转换统计">
      {stats ? <>已解析 {stats.parsed} 条 · 未解析 {stats.rejected} 行 · 去重 {stats.duplicates} 条 · 有效输出 {stats.output} 条<br />改写移除 {stats.removed} 条 · 替换 {stats.replaced} 条 · 追加 {stats.appended} 条 · 不支持 {stats.unsupported} 条 · 降级 {stats.degraded} 条</> : '等待转换结果'}
    </div>
    {(status || preview.error || sourceError) ? <div className="flex min-h-8 flex-wrap items-center gap-2 text-[12px] text-muted" role="status">
      {status}
      {(preview.error || sourceError) ? <FieldError error={preview.error || sourceError} /> : null}
      {sourceError ? <Button size="sm" onClick={() => void onRefreshSources()} disabled={sourceReading}>重新读取来源</Button> : null}
      {preview.error && <Button size="sm" onClick={() => void preview.refetch()} disabled={!ready || !settled || preview.isFetching}>重新转换</Button>}
    </div> : null}
    <details className={cx("text-[12.5px]", !diagnostic.length && "invisible")}><summary className="cursor-pointer">客户端处理详情（{diagnostic.length} 条）</summary>
      <div className="mt-2 max-h-64 overflow-auto">{diagnostic.slice(0, 100).map((d, i) => <div key={i} className="flex gap-2 py-1">
        {d.kind !== 'client' && <Badge tone="accent">{d.kind === 'degraded' ? '降级' : '改写'}</Badge>}
        <span className="min-w-0 break-all">{d.sourceId === '$append' ? '组级追加' : sourceNames[d.sourceId] ?? d.sourceId} · <code>{d.text}</code> · {d.reason}</span>
      </div>)}{diagnostic.length > 100 && <p>仅显示前 100 条。</p>}</div>
    </details>
  </div>;
}
