import { alertError, feedbackStore, notifySuccess } from '../feedback.ts';
import { useEffect, useRef } from 'react';
import type { LocalProxy } from '@sub-forge/core';
import { proxyFromPaste, proxyToYaml } from '../convert/proxyYaml.ts';
import { formatLocalNodeYaml, inspectLocalNodeYaml } from '../convert/localNodeYaml.ts';
import { Badge, Button } from './ui.tsx';
import { YamlTextarea } from './YamlTextarea.tsx';
import { CopyButton } from './CopyButton.tsx';

import type { RawResult } from '../convert/result.ts';

export function LocalNodeYamlEditor({ text, onChange, result, checking, disabled = false, autoFocus = false }: { disabled?: boolean; autoFocus?: boolean; text: string; onChange: (text: string) => void; result: RawResult<LocalProxy>; checking: boolean }) {
  const undo = useRef<{ before: string; after: string; notification: number } | undefined>(undefined);
  const latest = useRef({ text, disabled, onChange });
  latest.current = { text, disabled, onChange };
  const clearUndo = () => {
    if (undo.current) feedbackStore.dismiss(undo.current.notification);
    undo.current = undefined;
  };
  useEffect(() => { if (disabled || (undo.current && undo.current.after !== text)) clearUndo(); }, [text, disabled]);
  useEffect(() => clearUndo, []);
  const apply = (after: string, message: string) => {
    clearUndo();
    const before = text;
    onChange(after);
    const notification = notifySuccess(message, { label: '撤销', run: () => {
      if (latest.current.disabled || latest.current.text !== after) return;
      latest.current.onChange(before);
      undo.current = undefined;
    } });
    undo.current = { before, after, notification };
  };
  const node = !checking && result.ok ? result.value : undefined;
  const errorText = !checking && !result.ok && text.trim() ? `${result.line ? `第 ${result.line} 行：` : ''}${result.error}` : '';
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex items-center justify-between gap-3 border-b border-border bg-muted px-3 py-1">
      <label htmlFor="local-node-yaml" className="min-w-0 truncate text-sm text-muted-foreground">Mihomo YAML · 可直接粘贴分享链接 / JSON / Surge 行</label>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" variant="ghost" disabled={disabled || !node} onClick={() => {
          try { apply(formatLocalNodeYaml(text), '已格式化'); }
          catch (e) { alertError(e); }
        }}>格式化</Button>
        <CopyButton size="sm" variant="ghost" text={text} />
      </div>
    </div>
    <YamlTextarea className="local-node-source" placeholder="粘贴单个节点的分享链接、YAML、JSON 或 Surge 配置" disabled={disabled} id="local-node-yaml" aria-label="节点 YAML" aria-invalid={!!errorText} aria-describedby="local-node-status" lineNumbers autoFocus={autoFocus} value={text}
      onChange={e => { clearUndo(); onChange(e.target.value); }}
      onPaste={event => {
        const input = event.clipboardData.getData('text/plain');
        const imported = proxyFromPaste(input);
        if (!imported) return;
        // 完整节点替换全文；字段片段继续使用原生粘贴行为。
        event.preventDefault();
        if (!imported.ok) { alertError(`未导入：${imported.error}`); return; }
        const keepYaml = !/^[{\[]/.test(input.trim()) && inspectLocalNodeYaml(input).ok;
        const after = keepYaml ? input : proxyToYaml(imported.value);
        apply(after, keepYaml ? '已导入 YAML。' : imported.notes?.join('；') || '已转换为 YAML。');
      }} />
    <section aria-label="节点信息" className="flex shrink-0 flex-col gap-2 border-t border-border px-3 py-2.5">
      <div id="local-node-status" role="status" className="flex flex-wrap items-center gap-2">
        <Badge tone={!text.trim() || checking ? 'neutral' : node ? 'ok' : 'err'}>{!text.trim() ? '待输入' : checking ? '校验中…' : node ? '配置有效' : '配置有误'}</Badge>
        <span className="text-xs text-muted-foreground">一次一个节点；多个节点请用「编辑分组 YAML」</span>
      </div>
      {errorText && <div role="alert" className="text-sm text-destructive whitespace-pre-wrap">{errorText}</div>}
      {node && result.ok && result.notes?.map(note => <div key={note} className="text-xs text-warn">{note}</div>)}
    </section>
  </div>;
}
