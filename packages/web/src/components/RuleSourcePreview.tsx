import { useRef } from 'react';
import type { Matcher } from '@sub-forge/core';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api.ts';
import { CodePreview } from './CodePreview.tsx';
import { ruleToLine } from './rule.ts';
import { Button, FieldError, Modal } from './ui.tsx';

/** 只读源文件，与规则编辑及客户端输出预览分开。 */
export function RuleSourcePreview({ matcher: selected, onClose }: { matcher?: Matcher; onClose: () => void }) {
  const retained = useRef<Matcher>({ kind: 'rule', rule: { type: 'RAW', text: '' } });
  if (selected) retained.current = selected;
  const matcher = selected ?? retained.current;
  const preview = useQuery({
    queryKey: ['rule-matcher-source', matcher],
    enabled: !!selected && matcher.kind === 'ruleset', retry: false, staleTime: 60_000,
    queryFn: () => api<{ name: string; content: string; sources: number }>('POST', '/rules/matcher-source', { matcher }),
  });
  const single = matcher.kind === 'rule';
  const text = single ? ruleToLine(matcher.rule) : preview.data?.content ?? '';
  const loading = !single && preview.isPending;
  return <Modal title="规则预览" open={!!selected} onClose={onClose} wide footer={<Button onClick={onClose}>关闭</Button>}>
    {!single && preview.error ? <div className="flex flex-col items-start gap-3">
      <FieldError error={preview.error} /><Button size="sm" disabled={preview.isFetching} onClick={() => void preview.refetch()}>重新读取</Button>
    </div> : <>
      <span className="break-all text-[12.5px] text-muted">{single ? '静态规则' : loading ? '正在读取规则源文件…' : `${preview.data!.sources > 1 ? `合并源文件 · ${preview.data!.sources} 个来源` : '源文件'} · ${preview.data!.name}`}</span>
      <CodePreview label="完整规则源文件" text={text} loading={loading} lineNumbers copyable={!loading} bodyClassName="h-[420px]" />
      {!loading && !text && <span className="text-[12.5px] text-muted">源文件为空</span>}
    </>}
  </Modal>;
}
