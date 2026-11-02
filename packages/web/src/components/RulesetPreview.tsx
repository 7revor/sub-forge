import { useModalPresentation } from '../modals/index.tsx';
import { useQuery } from '@tanstack/react-query';
import { BASE_KERNELS, type BaseKernel, type RuleConversion, type RuleSetDelivery } from '@sub-forge/core';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import type { RuleSetDoc } from '../hooks.ts';
import { useDebouncedValue } from '../hooks/useDebouncedValue.ts';
import type { useRulesetSources } from '../hooks/useRulesetSources.ts';
import { CodePreview } from './CodePreview.tsx';
import { Badge, Button, FieldError, Segmented, cx } from './ui.tsx';

type Result = RuleConversion & { delivery: RuleSetDelivery; binary: boolean };
/** 只选择配置内核，与追加配置的顶层分组一致；转换由服务器完成。 */
export function RulesetPreview({ title, inputs, ready, sourceId, overrides, sourceError, sourceNames, sourceReading, onRefreshSources }: {
  title?: string;
  inputs: ReturnType<typeof useRulesetSources>['inputs']; ready: boolean; sourceId?: string;
  overrides: RuleSetDoc['overrides']; sourceError?: unknown; sourceNames: Record<string, string>; sourceReading: boolean; onRefreshSources: () => Promise<void>;
}) {
  const [target, setTarget] = useState<BaseKernel>('mihomo');
  const process = useModalPresentation(useDebouncedValue({ overrides }, 300));
  const body = { inputs, sourceId, ...process, client: target };
  const settled = JSON.stringify(process) === JSON.stringify({ overrides });
  const query = useQuery({
    queryKey: ['rule-conversion', body], enabled: ready && settled, retry: false, staleTime: 0,
    queryFn: () => api<Result>('POST', '/rules/convert', body),
    placeholderData: (previous, query) => {
      // 切换来源不能把旧来源内容当作新来源展示；内核切换允许保留并明确标注旧结果。
      const previousBody = query?.queryKey[1] as typeof body | undefined;
      return previousBody?.sourceId === sourceId ? previous : undefined;
    },
  });
  const preview = useModalPresentation(query);
  const last = useRef<{ sourceId?: string; target: string; result: Result } | undefined>(undefined);
  useEffect(() => { if (preview.data && !preview.isPlaceholderData) last.current = { sourceId, target, result: preview.data }; }, [preview.data, preview.isPlaceholderData, sourceId, target]);
  const pending = !ready || !settled || preview.isFetching;
  const result = preview.data ?? (last.current?.sourceId === sourceId ? last.current?.result : undefined);
  const old = pending || preview.isPlaceholderData || !!preview.error || !!sourceError;
  const stats = result?.stats;
  const previousLabel = BASE_KERNELS.find(x => x.value === last.current?.target)?.label;
  const diagnostic = result?.diagnostics.filter(d => ['client', 'degraded', 'override'].includes(d.kind)) ?? [];
  const status = sourceError && !sourceReading ? result ? '来源读取失败，暂显示上次结果。' : '来源读取失败，尚无可用预览。'
    : pending ? result ? `正在更新，暂显示上次${previousLabel ? ` ${previousLabel}` : ''}结果…` : '正在加载规则…'
    : preview.error ? `更新失败，暂显示上次${previousLabel ? ` ${previousLabel} ` : ''}结果。`
    : result?.delivery.mode === 'unsupported' ? result.delivery.reason
    : result?.binary ? 'MRS 由服务端缓存并原样托管，无法展示文本；SRS 暂不支持。' : null;
  return <div className="flex flex-col gap-3" aria-label="规则转换预览">
    <div className="flex flex-wrap items-center justify-between gap-3">{title && <h2 className="m-0 text-base font-semibold">{title}</h2>}<Segmented size="sm" label="规则内核" value={target} onChange={setTarget} options={[...BASE_KERNELS]} /></div>
    <CodePreview label="规则输出" text={result?.lines.join('\n') ?? ''} loading={old} className="shrink-0" bodyClassName="h-[430px]" lineNumbers />
    <div className="min-h-10 text-sm text-foreground" aria-label="转换统计">
      {stats ? <div className="grid grid-cols-4 gap-2 py-1">{[['解析', stats.parsed], ['去重', stats.duplicates], ['不支持', stats.unsupported], ['有效输出', stats.output]].map(([label, value]) => <div key={label}><span className="block text-xs text-muted-foreground">{label}</span><span className={label === '有效输出' ? 'font-medium text-ok' : 'font-medium'}>{value}</span></div>)}</div> : '等待转换结果'}
    </div>
    {(status || preview.error || sourceError) ? <div className="flex min-h-8 flex-wrap items-center gap-2 text-xs text-muted-foreground" role="status">
      {status}
      {(preview.error || sourceError) ? <FieldError error={preview.error || sourceError} /> : null}
      {sourceError ? <Button size="sm" onClick={() => void onRefreshSources()} disabled={sourceReading}>重新读取来源</Button> : null}
      {preview.error && <Button size="sm" onClick={() => void preview.refetch()} disabled={!ready || !settled || preview.isFetching}>重新转换</Button>}
    </div> : null}
    <details className={cx("text-sm", !diagnostic.length && "invisible")}><summary className="cursor-pointer">内核处理详情（{diagnostic.length} 条）</summary>
      <div className="mt-2 max-h-64 overflow-auto">{diagnostic.slice(0, 100).map((d, i) => <div key={i} className="flex gap-2 py-1">
        {d.kind !== 'client' && <Badge tone="accent">{d.kind === 'degraded' ? '降级' : '改写'}</Badge>}
        <span className="min-w-0 break-all">{d.sourceId === '$append' ? '组级追加' : sourceNames[d.sourceId] ?? d.sourceId} · <code>{d.text}</code> · {d.reason}</span>
      </div>)}{diagnostic.length > 100 && <p>仅显示前 100 条。</p>}</div>
    </details>
  </div>;
}
