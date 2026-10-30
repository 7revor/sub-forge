import { useEffect, useRef, useSyncExternalStore } from 'react';
import { CircleCheck, CircleAlert } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { alertError, feedbackStore, type Feedback } from '../feedback.ts';
import { AlertDialog, overlayMotion, panelMotion, restoreOverlayFocus } from './primitives/overlays.tsx';
import { cx } from './cx.ts';

function ErrorDialog({ item }: { item?: Feedback }) {
  const retained = useRef(item);
  const previousFocus = useRef<Element | null>(null);
  const wasOpen = useRef(false);
  if (item) retained.current = item;
  if (item && !wasOpen.current) previousFocus.current = document.activeElement;
  wasOpen.current = !!item;
  const shown = retained.current;
  return <AlertDialog.Root open={!!item} onOpenChange={open => { if (!open && item) feedbackStore.dismiss(item.id); }}>
    <AlertDialog.Portal>
      <AlertDialog.Overlay data-slot="alert-dialog-overlay" className={cx('fixed inset-0 z-[110] bg-[rgba(20,23,28,.42)]', overlayMotion)} />
      <AlertDialog.Content data-slot="alert-dialog-content"
        onCloseAutoFocus={event => { event.preventDefault(); restoreOverlayFocus(previousFocus.current); }}
        className={cx('fixed top-1/2 left-1/2 z-[110] max-h-[85dvh] w-[calc(100%-2rem)] max-w-[480px] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-line bg-panel p-0 text-ink shadow-2xl outline-none', panelMotion)}>
        <div className="flex items-center gap-2 px-5 pt-5"><CircleAlert size={22} className="text-err" aria-hidden="true" /><AlertDialog.Title className="m-0 text-base font-semibold">操作失败</AlertDialog.Title></div>
        <AlertDialog.Description className="m-0 whitespace-pre-wrap break-words px-5 py-4 text-[13.5px] leading-relaxed">{shown?.message}</AlertDialog.Description>
        <div className="flex justify-end border-t border-line bg-ground px-5 py-3"><AlertDialog.Cancel className="h-10 cursor-pointer rounded-lg bg-accent px-5 text-[13.5px] font-medium text-white hover:bg-accent-strong">知道了</AlertDialog.Cancel></div>
      </AlertDialog.Content>
    </AlertDialog.Portal>
  </AlertDialog.Root>;
}

export function FeedbackHost() {
  const items = useSyncExternalStore(feedbackStore.subscribe, feedbackStore.getSnapshot);
  const shown = useRef(new Set<number>());
  useEffect(() => {
    for (const item of items.filter(item => item.kind === 'success')) {
      if (shown.current.has(item.id)) continue;
      shown.current.add(item.id);
      toast.success(item.message, {
        id: `feedback-${item.id}`, duration: item.action ? Infinity : 4500,
        onDismiss: () => feedbackStore.dismiss(item.id), onAutoClose: () => feedbackStore.dismiss(item.id),
        ...(item.action ? { action: { label: item.action.label, onClick: () => {
          feedbackStore.dismiss(item.id);
          try { item.action!.run(); } catch (error) { alertError(error); }
        } } } : {}),
      });
    }
    for (const id of shown.current) {
      if (items.some(item => item.id === id)) continue;
      toast.dismiss(`feedback-${id}`); shown.current.delete(id);
    }
  }, [items]);
  useEffect(() => () => { for (const id of shown.current) toast.dismiss(`feedback-${id}`); shown.current.clear(); }, []);
  return <>
    <Toaster theme="light" position="top-right" expand closeButton containerAriaLabel="操作通知" customAriaLabel="操作通知" gap={12}
      icons={{ success: <CircleCheck size={20} className="text-ok" aria-hidden="true" /> }}
      toastOptions={{ closeButtonAriaLabel: '关闭通知', style: { background: 'var(--color-panel)', color: 'var(--color-ink)', borderColor: 'var(--color-line)' },
        classNames: { title: 'whitespace-pre-wrap break-words text-[13px] font-normal', actionButton: 'bg-accent text-white' } }} />
    <ErrorDialog item={items.find(item => item.kind === 'error')} />
  </>;
}

/** 兼容查询或受控错误状态，普通重渲染不会重复提示。 */
export function ErrorAlert({ error }: { error: unknown }) {
  const previous = useRef<unknown>(undefined);
  useEffect(() => {
    if (error && error !== previous.current) alertError(error);
    previous.current = error;
  }, [error]);
  return null;
}
