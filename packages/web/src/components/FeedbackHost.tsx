import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { CircleCheck, CircleAlert, X } from 'lucide-react';
import { alertError, feedbackStore, type Feedback } from '../feedback.ts';

function Notification({ item }: { item: Feedback }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    // 带撤销操作的通知由用户关闭，避免操作入口提前消失。
    if (paused || item.action) return;
    const timer = setTimeout(() => feedbackStore.dismiss(item.id), 4500);
    return () => clearTimeout(timer);
  }, [item.id, item.action, paused]);
  return <div role="status" className="notification pointer-events-auto flex items-start gap-3 rounded-xl border border-line bg-panel p-4 text-[13px] shadow-lg"
    onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setPaused(false); }}>
    <CircleCheck size={20} className="shrink-0 text-ok" aria-hidden="true" />
    <div className="min-w-0 flex-1 whitespace-pre-wrap break-words">{item.message}
      {item.action && <button type="button" className="mt-2 block cursor-pointer font-medium text-accent" onClick={() => {
        feedbackStore.dismiss(item.id);
        try { item.action!.run(); } catch (error) { alertError(error); }
      }}>{item.action.label}</button>}
    </div>
    <button type="button" aria-label="关闭通知" className="-m-1 grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted hover:bg-ground" onClick={() => feedbackStore.dismiss(item.id)}><X size={16} /></button>
  </div>;
}

function ErrorDialog({ item }: { item: Feedback }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (open) return;
    const timer = setTimeout(() => feedbackStore.dismiss(item.id), window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160);
    return () => clearTimeout(timer);
  }, [open, item.id]);
  const dialog = useRef<HTMLDialogElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current!;
    element.showModal();
    confirm.current?.focus();
    return () => {
      element.close();
      if (previous instanceof HTMLElement && previous !== document.body && previous.isConnected) previous.focus();
      else document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"] input:not(:disabled), [role="dialog"][aria-modal="true"] button:not(:disabled)')?.focus();
    };
  }, []);
  return <dialog data-state={open ? 'open' : 'closed'} ref={dialog} role="alertdialog" aria-modal="true" aria-labelledby={`feedback-title-${item.id}`} aria-describedby={`feedback-message-${item.id}`}
    className="feedback-dialog m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-[480px] overflow-auto rounded-xl border border-line bg-panel p-0 text-ink shadow-2xl backdrop:bg-[rgba(20,23,28,.42)]"
    onCancel={event => { event.preventDefault(); setOpen(false); }}>
    <div className="flex items-center gap-2 px-5 pt-5"><CircleAlert size={22} className="text-err" aria-hidden="true" /><h2 id={`feedback-title-${item.id}`} className="m-0 text-base font-semibold">操作失败</h2></div>
    <p id={`feedback-message-${item.id}`} className="m-0 whitespace-pre-wrap break-words px-5 py-4 text-[13.5px] leading-relaxed">{item.message}</p>
    <div className="flex justify-end border-t border-line bg-ground px-5 py-3"><button ref={confirm} type="button" className="h-10 cursor-pointer rounded-lg bg-accent px-5 text-[13.5px] font-medium text-white hover:bg-accent-strong" onClick={() => setOpen(false)}>知道了</button></div>
  </dialog>;
}

export function FeedbackHost() {
  const items = useSyncExternalStore(feedbackStore.subscribe, feedbackStore.getSnapshot);
  const error = items.find(item => item.kind === 'error');
  return createPortal(<>
    <div aria-label="操作通知" className="pointer-events-none fixed top-4 right-4 z-[100] flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[380px] flex-col gap-3 overflow-y-auto">
      {items.filter(item => item.kind === 'success').map(item => <Notification key={item.id} item={item} />)}
    </div>
    {error && <ErrorDialog key={error.id} item={error} />}
  </>, document.body);
}

/** 兼容查询或受控错误状态，不占文档流；严格模式和普通重渲染不会重复提示。 */
export function ErrorAlert({ error }: { error: unknown }) {
  const previous = useRef<unknown>(undefined);
  useEffect(() => {
    if (error && error !== previous.current) alertError(error);
    previous.current = error;
  }, [error]);
  return null;
}
