import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog.tsx';
import { useRef } from 'react';
import type { Matcher } from '@sub-forge/core';
import type { RuleSetSourceDoc } from '../hooks.ts';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api.ts';
import { rulesetSourceQuery } from '../domain/rulesetSources.ts';
import { CodePreview } from './CodePreview.tsx';
import { ruleToLine } from './rule.ts';
import { Button, FieldError } from './ui.tsx';

type Source = { rulesetId?: string; source: RuleSetSourceDoc };
/** 三处统一只读预览；预览与编辑、合并输出相互独立。 */
export function RuleSourcePreview({ matcher, source, onClose }: { matcher?: Matcher; source?: Source; onClose: () => void }) {
  const open = !!matcher || !!source;
  const retained = useRef<{ matcher?: Matcher; source?: Source }>({ matcher: { kind: 'local', content: '' } });
  if (open) retained.current = { matcher, source };
  const current = retained.current;
  const reference = useQuery({
    queryKey: ['rule-matcher-source', current.matcher], enabled: open && current.matcher?.kind === 'ruleset', retry: false, staleTime: 0,
    queryFn: () => api<{ name: string; content: string; sources: number }>('POST', '/rules/matcher-source', { matcher: current.matcher }),
  });
  const loaded = useQuery({ ...rulesetSourceQuery(current.source?.rulesetId, current.source?.source ?? { id: '', kind: 'local', content: '', format: 'auto' }), enabled: open && !!current.source });
  const local = current.matcher?.kind === 'local' || current.matcher?.kind === 'rule';
  const query = current.source ? loaded : reference;
  const text = current.source ? loaded.data?.content ?? '' : current.matcher?.kind === 'local' ? current.matcher.content : current.matcher?.kind === 'rule' ? ruleToLine(current.matcher.rule) : reference.data?.content ?? '';
  const error = query.error ?? (current.source && (loaded.data?.status.error ?? (loaded.data?.status.passthrough ? '二进制规则无法展示文本源文件' : undefined)));
  const loading = !local && query.isPending;
  const label = current.source ? current.source.source.name ?? current.source.source.url ?? '本地规则' : local ? '本地规则' : reference.data?.name ?? '正在读取规则源文件…';
  return <Dialog open={open} onOpenChange={next => { if (!next) onClose(); }}><DialogContent className="flex h-[min(640px,calc(100dvh-2rem))] min-w-0 flex-col overflow-hidden sm:max-w-[800px] [&>*]:min-w-0" style={{ width: 'min(800px, calc(100vw - 2rem))' }} aria-describedby={undefined}>
    <DialogHeader className="shrink-0"><DialogTitle>规则预览</DialogTitle></DialogHeader>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3.5 overflow-hidden">
      {error ? <div className="flex flex-col items-start gap-3"><FieldError error={error} /><Button size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>重新读取</Button></div> : <>
        <span className="line-clamp-2 shrink-0 break-all text-[12.5px] text-ink-muted">{label}</span>
        <CodePreview label="完整规则源文件" text={text} loading={loading} lineNumbers fill bodyClassName="overscroll-contain" />
        {!loading && !text && <span className="text-[12.5px] text-ink-muted">源文件为空</span>}
      </>}
    </div><DialogFooter className="shrink-0"><Button onClick={onClose}>关闭</Button></DialogFooter>
  </DialogContent></Dialog>;
}
