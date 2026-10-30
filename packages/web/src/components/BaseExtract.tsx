import { useState } from 'react';
import { extractCommonBase, mergeBase, type Client, type CommonBase } from '@sub-forge/core';
import { Button, ErrorAlert } from './ui.tsx';
export function BaseExtract({ client, value, common, onApply, disabled }: { client: Client; value: Record<string, unknown>; common?: CommonBase; onApply: (common: CommonBase, native: Record<string, unknown>) => void; disabled?: boolean }) {
  const [preview, setPreview] = useState(false);
  let result: ReturnType<typeof extractCommonBase> | undefined, error: unknown;
  if (preview) try { result = extractCommonBase(value, client); } catch (cause) { error = cause; }
  return <div className="space-y-2 text-[13px]">
    <Button disabled={disabled} onClick={() => setPreview(!preview)}>提取公共基础项</Button>
    {preview && <><p>可等价表达的字段移到公共项；已有公共值优先。其余字段保留在本客户端覆盖中。应用后仍需保存。</p><ErrorAlert error={error} />
      {result && <><p>可提取：{Object.keys(result.common).join('、') || '没有可提取项'}</p>
        {result.report.map((r, i) => <p key={i} className="text-ink-muted">{r.message}</p>)}
        <Button disabled={!Object.keys(result.common).length || disabled} onClick={() => { onApply(mergeBase(result!.common, common ?? {}) as CommonBase, result!.native); setPreview(false); }}>应用到草稿</Button></>}
    </>}
  </div>;
}
