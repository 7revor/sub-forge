import { useEffect, useRef, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { Toaster } from './ui/sonner.tsx';
import { alertError, feedbackStore } from '../feedback.ts';
import { useInModal, useModalPresentation } from '../modals/index.tsx';
import { Frame } from '../modals/Frame.tsx';

export function FeedbackHost() {
  const items = useSyncExternalStore(feedbackStore.subscribe, feedbackStore.getSnapshot);
  const errorShown = useRef(new Set<number>());
  useEffect(() => {
    const item = items.find(item => item.kind === 'error');
    if (!item || errorShown.current.has(item.id)) return;
    errorShown.current.add(item.id);
    void Frame.modal.error({ title: '操作失败', description: item.message }).then(() => { feedbackStore.dismiss(item.id); errorShown.current.delete(item.id); });
  }, [items]);
  const shown = useRef(new Set<number>());
  useEffect(() => {
    for (const item of items.filter(item => item.kind === 'success')) {
      if (shown.current.has(item.id)) continue;
      shown.current.add(item.id);
      toast.success(item.message, {
        id: `feedback-${item.id}`, ...(item.action ? { duration: Infinity } : {}),
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
    <Toaster />

  </>;
}

/** 兼容查询或受控错误状态，普通重渲染不会重复提示。 */
export function ErrorAlert({ error }: { error: unknown }) {
  const inModal = useInModal();
  const shownError = useModalPresentation(error);
  const previous = useRef<unknown>(undefined);
  useEffect(() => {
    if (!inModal && error && error !== previous.current) alertError(error);
    previous.current = error;
  }, [error, inModal]);
  return inModal && shownError ? <p role="alert" className="m-0 text-[13px] text-err">{shownError instanceof Error ? shownError.message : String(shownError)}</p> : null;
}
