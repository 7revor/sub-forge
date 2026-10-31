import { useQuery } from '@tanstack/react-query';
import { normalizeRuleUrl } from '@sub-forge/core';
import { useModalActive, useModalDraft, useModalPresentation } from '../modals/index.tsx';
import { rulesetSourceQuery } from '../domain/rulesetSources.ts';
import { CodePreview } from './CodePreview.tsx';
import { Button, FieldError, Input } from './ui.tsx';

/** 显式读取当前地址；改地址后旧结果不再配对新输入，关闭期间保留最后展示。 */
export function RemoteRuleInput({ id, value, onChange }: { id: string; value: string; onChange: (url: string) => void }) {
  const [requested, setRequested] = useModalDraft<string>();
  const active = useModalActive();
  let valid = false;
  try { normalizeRuleUrl(value); valid = true; } catch { /* 无效输入交由上层表单显示错误，读取按钮禁用。 */ }
  const query = useQuery({ ...rulesetSourceQuery(undefined, { id: 'remote-preview', kind: 'remote', url: requested, format: 'auto' }), enabled: active() && !!requested });
  const view = useModalPresentation(query);
  return <div className="flex min-w-0 flex-col gap-3">
    <div className="flex gap-2"><Input id={id} type="url" className="min-w-0 font-mono" spellCheck={false} value={value} placeholder="远程规则文件的 HTTP 或 HTTPS 地址" onChange={event => { setRequested(undefined); onChange(event.target.value); }} /><Button disabled={!valid || view.isFetching} onClick={() => { if (requested === value) void query.refetch(); else setRequested(value); }}>{view.isFetching ? '读取中…' : '读取'}</Button></div>
    {requested && <><FieldError error={view.error ?? view.data?.status.error} />
      {view.data?.content !== undefined && <CodePreview label="远程规则预览" text={view.data.content} bodyClassName="max-h-[140px] overflow-auto p-3 text-[length:var(--text-caption)] leading-5" />}
      {view.data?.status.ok && <span className="text-[length:var(--text-caption)] text-ink-muted">识别为 {view.data.status.format ?? '规则文本'} · 有效 {view.data.status.rules ?? 0} 条 · 不支持 {view.data.status.rejected ?? 0}</span>}
    </>}
  </div>;
}
