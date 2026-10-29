import { useCallback, useEffect, useRef, useState } from 'react';

/** 只有浏览器确认写入后才反馈成功；文本改变和卸载均使旧请求失效。 */
export function useClipboard(text: string) {
  const [state, setState] = useState<{ text: string; status: 'pending' | 'copied' | 'error'; error?: string }>();
  const sequence = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    setState(undefined);
    return () => { sequence.current++; clearTimeout(timer.current); };
  }, [text]);
  const copy = useCallback(async () => {
    const request = ++sequence.current;
    clearTimeout(timer.current);
    setState({ text, status: 'pending' });
    try {
      if (!navigator.clipboard?.writeText) throw new Error('当前浏览器不支持剪贴板写入');
      await navigator.clipboard.writeText(text);
      if (request !== sequence.current) return;
      setState({ text, status: 'copied' });
      timer.current = setTimeout(() => setState(undefined), 1500);
    } catch (error) {
      if (request === sequence.current) setState({ text, status: 'error', error: `复制失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }, [text]);
  return { copy, status: state?.text === text ? state.status : undefined, error: state?.text === text ? state.error : undefined };
}
