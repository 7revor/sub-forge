import { createModal, useModalDraft, useModalPresentation, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '../modals/index.tsx';
import type { Matcher } from '@sub-forge/core';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api.ts';
import { CodePreview } from './CodePreview.tsx';
import { ruleToLine } from './rule.ts';
import { Button, FieldError, } from './ui.tsx';

/** 只读源文件，与规则编辑及客户端输出预览分开。 */
export const RuleSourcePreview = createModal<{ matcher: Matcher }>(function RulePreview({ data: { matcher }, modal }) {
  const onClose = modal.cancel;
  const previewQuery = useQuery({
    queryKey: ['rule-matcher-source', matcher],
    enabled: modal.active && matcher.kind === 'ruleset', retry: false, staleTime: 0,
    queryFn: () => api<{ name: string; content: string; sources: number }>('POST', '/rules/matcher-source', { matcher }),
  });
  const preview = useModalPresentation(previewQuery);
  const single = matcher.kind === 'rule';
  const text = single ? ruleToLine(matcher.rule) : preview.data?.content ?? '';
  const loading = !single && preview.isPending;
  return <ModalContent className="flex h-[min(640px,calc(100dvh-2rem))] min-w-0 flex-col overflow-hidden sm:max-w-[800px] [&>*]:min-w-0" style={{ width: 'min(800px, calc(100vw - 2rem))' }} aria-describedby={undefined}><ModalHeader className="shrink-0"><ModalTitle>{"规则预览"}</ModalTitle></ModalHeader><div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3.5 overflow-hidden">
    {!single && preview.error ? <div className="flex flex-col items-start gap-3">
      <FieldError error={preview.error} /><Button size="sm" disabled={preview.isFetching} onClick={() => void preview.refetch()}>重新读取</Button>
    </div> : <>
      <span className="line-clamp-2 shrink-0 break-all text-[12.5px] text-ink-muted">{single ? '静态规则' : loading ? '正在读取规则源文件…' : `${preview.data!.sources > 1 ? `合并源文件 · ${preview.data!.sources} 个来源` : '源文件'} · ${preview.data!.name}`}</span>
      <CodePreview label="完整规则源文件" text={text} loading={loading} lineNumbers fill bodyClassName="overscroll-contain" />
      {!loading && !text && <span className="text-[12.5px] text-ink-muted">源文件为空</span>}
    </>}
  </div><ModalFooter className="shrink-0">{<Button onClick={onClose}>关闭</Button>}</ModalFooter></ModalContent>;
});
