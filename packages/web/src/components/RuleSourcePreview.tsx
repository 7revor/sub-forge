import { createModal, useModalPresentation, ModalContent, ModalHeader, ModalTitle } from '../modals/index.tsx';
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
export const RuleSourcePreview = createModal<{ matcher?: Matcher; source?: Source }>(function SourcePreview({ data: current, modal }) {
  const open = modal.active;
  const referenceQuery = useQuery({
    queryKey: ['rule-matcher-source', current.matcher], enabled: open && current.matcher?.kind === 'ruleset', retry: false, staleTime: 0,
    queryFn: () => api<{ name: string; content: string; sources: number }>('POST', '/rules/matcher-source', { matcher: current.matcher }),
  });
  const loadedQuery = useQuery({ ...rulesetSourceQuery(current.source?.rulesetId, current.source?.source ?? { id: '', kind: 'local', content: '', format: 'auto' }), enabled: open && !!current.source });
  const reference = useModalPresentation(referenceQuery);
  const loaded = useModalPresentation(loadedQuery);
  const local = current.matcher?.kind === 'local' || current.matcher?.kind === 'rule';
  const query = current.source ? loaded : reference;
  const text = current.source ? loaded.data?.content ?? '' : current.matcher?.kind === 'local' ? current.matcher.content : current.matcher?.kind === 'rule' ? ruleToLine(current.matcher.rule) : reference.data?.content ?? '';
  const error = query.error ?? (current.source && (loaded.data?.status.error ?? (loaded.data?.status.binary ? '二进制规则无法展示文本源文件' : undefined)));
  const loading = !local && query.isPending;
  const label = current.source ? current.source.source.name ?? current.source.source.url ?? '本地规则' : local ? '本地规则' : reference.data?.name ?? '正在读取规则源文件…';
  return <ModalContent className="flex h-[min(640px,calc(100dvh-2rem))] min-w-0 flex-col overflow-hidden pb-9 sm:max-w-[800px] [&>*]:min-w-0" style={{ width: 'min(800px, calc(100vw - 2rem))' }} aria-describedby={undefined}>
    <ModalHeader className="shrink-0"><ModalTitle>规则预览</ModalTitle></ModalHeader>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3.5 overflow-hidden">
      {error ? <div className="flex flex-col items-start gap-3"><FieldError error={error} /><Button size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>重新读取</Button></div> : <>
        <span className="line-clamp-2 shrink-0 break-all text-[12.5px] text-ink-muted">{label}</span>
        <CodePreview label="完整规则源文件" text={text} loading={loading} lineNumbers fill bodyClassName="overscroll-contain" />
        {!loading && !text && <span className="text-[12.5px] text-ink-muted">源文件为空</span>}
      </>}
    </div>
  </ModalContent>;
});
