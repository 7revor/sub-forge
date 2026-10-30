import { useEffect, useRef, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { Toaster } from './ui/sonner.tsx';
import { alertError, feedbackStore, type Feedback } from '../feedback.ts';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from './ui/alert-dialog.tsx';
import { useDialogDraft } from '../hooks/useDialogDraft.ts';

function ErrorDialog({ item }: { item?: Feedback }) {
  const [message] = useDialogDraft(!!item, item?.message, item ? String(item.id) : undefined);
  return <AlertDialog open={!!item} onOpenChange={open => { if (!open && item) feedbackStore.dismiss(item.id); }}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>操作失败</AlertDialogTitle>
        <AlertDialogDescription className="whitespace-pre-wrap break-words">{message}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel>知道了</AlertDialogCancel></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}

export function FeedbackHost() {
  const items = useSyncExternalStore(feedbackStore.subscribe, feedbackStore.getSnapshot);
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
