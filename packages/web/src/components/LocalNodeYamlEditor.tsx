import { alertError, feedbackStore, notifySuccess } from '../feedback.ts';
import { useEffect, useRef } from 'react';
import type { LocalProxy } from '@sub-forge/core';
import { proxyFromPaste, proxyToYaml } from '../convert/proxyYaml.ts';
import { formatLocalNodeYaml, inspectLocalNodeYaml } from '../convert/localNodeYaml.ts';
import { Badge, Button } from './ui.tsx';
import { YamlTextarea } from './YamlTextarea.tsx';
import { CopyButton } from './CopyButton.tsx';
import { NodeConnectivity } from './NodeConnectivity.tsx';
import type { RawResult } from './DualEditor.tsx';

export function LocalNodeYamlEditor({ text, onChange, result, checking, disabled = false }: { disabled?: boolean; text: string; onChange: (text: string) => void; result: RawResult<LocalProxy>; checking: boolean }) {
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
  const details = node ? [
    ['名称', node.name], ['协议', node.type.toUpperCase()], ['服务器', node.server], ['端口', node.port],
    ...(node.cipher ? [['加密方式', node.cipher]] : []), ...(node.network ? [['传输方式', node.network]] : []),
    ...(typeof node.tls === 'boolean' ? [['TLS', node.tls ? '开启' : '关闭']] : []),
    ...(typeof node.udp === 'boolean' ? [['UDP', node.udp ? '开启' : '关闭']] : []),
  ] : [];
  return <div className="flex flex-col gap-3">
    <div className="flex items-center justify-between gap-3">
      <label htmlFor="local-node-yaml" className="text-[13px] text-ink-muted">节点 YAML</label>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={disabled || !node} onClick={() => {
          try { apply(formatLocalNodeYaml(text), '已格式化'); }
          catch (e) { alertError(e); }
        }}>格式化</Button>
        <CopyButton size="sm" text={text} />
      </div>
    </div>
    <p className="m-0 text-[12px] text-ink-muted">支持直接编辑 YAML，粘贴节点分享链接、JSON 或 Surge 配置自动转换。</p>
    <YamlTextarea placeholder="粘贴单个节点的分享链接、YAML、JSON 或 Surge 配置" disabled={disabled} id="local-node-yaml" aria-label="节点 YAML" aria-invalid={!!errorText} aria-describedby="local-node-status" rows={16} value={text}
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
    <section aria-label="节点信息" className="rounded-xl border border-line bg-[#f8fafc] p-4 flex flex-col gap-3">
      <div id="local-node-status" role="status" className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold">节点信息</span>
        <Badge tone={!text.trim() || checking ? 'neutral' : node ? 'ok' : 'err'}>{!text.trim() ? '待输入' : checking ? '校验中…' : node ? '配置有效' : '配置有误'}</Badge>
        {node && <span className="text-[12px] text-ink-muted">已通过基础配置校验</span>}
      </div>
      {node ? <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3 lg:grid-cols-4">{details.map(([label, value]) => <div key={String(label)} className="min-w-0">
        <dt className="mb-1 text-[12px] text-ink-muted">{String(label)}</dt><dd className="m-0 break-all text-[13px]">{String(value)}</dd>
      </div>)}</dl> : <div className="text-[13px] text-ink-muted">{!text.trim() ? '粘贴配置后显示节点摘要' : checking ? '正在解析当前配置…' : '当前配置无法解析'}</div>}
      {errorText && <div role="alert" className="text-[13px] text-err whitespace-pre-wrap">{errorText}</div>}
      {node && result.ok && result.notes?.map(note => <div key={note} className="text-[12px] text-warn">{note}</div>)}
      <NodeConnectivity node={node} text={text} />
    </section>
  </div>;
}
