import { alertError, notifySuccess } from '../feedback.ts';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LocalProxy } from '@sub-forge/core';
import { api } from '../api.ts';
import { createProbeRequestId } from '../domain/probeRequestId.ts';
import { Badge, Button } from './ui.tsx';

type Result = { ok: boolean; status: 'success' | 'failed' | 'unavailable' | 'cancelled'; message: string; delay?: number; testedAt: number; target: string };
export function NodeConnectivity({ node, text }: { node?: LocalProxy; text: string }) {
  const capability = useQuery({ queryKey: ['node-probe'], queryFn: () => api<{ available: boolean }>('GET', '/node-probe'), retry: false });
  const [result, setResult] = useState<{ text: string; data: Result }>();
  const [running, setRunning] = useState(false);
  const active = useRef<string | undefined>(undefined);
  const currentText = useRef(text);
  currentText.current = text;
  const cancel = () => {
    const id = active.current;
    active.current = undefined;
    if (id) void api('DELETE', `/node-probe/${id}`).catch(() => alertError('取消请求未送达，服务端会在超时后结束测试'));
  };
  useEffect(() => {
    setRunning(false);
    return cancel;
  }, [text]); // 输入变化或离开页面时取消测试；旧响应由请求标识与文本双重隔离。
  const run = async () => {
    if (!node || active.current) return;
    let requestId: string | undefined;
    setRunning(true);
    try {
      requestId = createProbeRequestId();
      active.current = requestId;
      const data = await api<Result>('POST', '/node-probe', { node, requestId });
      if (active.current === requestId && currentText.current === text) {
        setResult({ text, data });
        if (data.ok) notifySuccess(data.message);
        else if (data.status !== 'cancelled') alertError(data.message);
      }
    } catch (error) {
      if (active.current === requestId && currentText.current === text) { alertError(error); setResult({ text, data: { ok: false, status: 'failed', message: error instanceof Error ? error.message : String(error), testedAt: Date.now(), target: '' } }); }
    } finally {
      if (active.current === requestId) { active.current = undefined; setRunning(false); }
    }
  };
  const stale = !!result && result.text !== text;
  const status = running ? '测试中…' : stale ? '配置已修改，请重新测试' : result?.data.message ?? (capability.isPending ? '检查测试服务…' : capability.error ? '无法获取测试服务状态' : capability.data?.available ? '未测试' : '测试服务未配置');
  return <div className="flex flex-col gap-2 border-t border-line pt-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2" role="status">
        <span className="text-[13px] text-muted">连通性</span>
        <Badge tone={running || stale ? 'neutral' : result?.data.ok ? 'ok' : result?.data.status === 'failed' ? 'err' : 'neutral'}>{status}</Badge>
        {!running && !stale && result?.data.ok && <span className="font-mono text-[13px]">{result.data.delay} ms</span>}
      </div>
      {running ? <Button size="sm" onClick={() => { cancel(); setRunning(false); setResult({ text, data: { ok: false, status: 'cancelled', message: '测试已取消', testedAt: Date.now(), target: '' } }); }}>取消测试</Button>
        : <Button size="sm" disabled={!node || !capability.data?.available} onClick={() => void run()}>测试连通性</Button>}
    </div>
    <div className="text-[12px] leading-relaxed text-muted">
      从 Sub Forge 服务端发起，测试当前配置，无需先保存。
      {result && !running && !stale && <span> 上次测试：{new Date(result.data.testedAt).toLocaleString('zh-CN')}{result.data.target ? ` · ${result.data.target}` : ''}</span>}
      {capability.error && <Button size="sm" onClick={() => void capability.refetch()}>重试</Button>}
    </div>
  </div>;
}
