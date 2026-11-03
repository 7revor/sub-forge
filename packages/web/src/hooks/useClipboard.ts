import { alertError } from '../feedback.ts';
import { useCallback, useEffect, useRef, useState } from 'react';

/** 用临时文本框选中后复制。放进最上层弹窗内，否则焦点陷阱会抢回焦点导致选区为空。 */
function copyBySelection(text: string): boolean {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  const selection = document.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i)) : [];
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.readOnly = true;
  textarea.tabIndex = -1;
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;font-size:16px';
  const dialogs = document.querySelectorAll('[role="dialog"],[role="alertdialog"]');
  (dialogs[dialogs.length - 1] ?? document.body).append(textarea);
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } finally {
    textarea.remove();
    active?.focus({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      ranges.forEach(range => selection.addRange(range));
    }
  }
}

/** navigator.clipboard 仅安全上下文（HTTPS / localhost）可用；HTTP 部署或异步写入被拒时退回选区复制。 */
export async function writeClipboard(text: string): Promise<void> {
  let rejected: unknown;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      rejected = error;
    }
  }
  if (!copyBySelection(text)) throw rejected ?? new Error('浏览器拒绝了复制操作');
}

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
      await writeClipboard(text);
      if (request !== sequence.current) return;
      setState({ text, status: 'copied' });
      timer.current = setTimeout(() => setState(undefined), 1500);
    } catch (error) {
      if (request === sequence.current) {
        const message = `复制失败：${error instanceof Error ? error.message : String(error)}`;
        setState({ text, status: 'error', error: message });
        alertError(message);
      }
    }
  }, [text]);
  return { copy, status: state?.text === text ? state.status : undefined, error: state?.text === text ? state.error : undefined };
}
