import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogFooter, AlertDialogDescription, AlertDialogCancel } from './ui/alert-dialog.tsx';
import type { Blocker } from 'react-router';
import { Button, ErrorAlert, } from './ui.tsx';
import { useDialogPresentation } from '../hooks/useDialogPresentation.ts';

export function LeaveDialog({ blocker, what, canSave, pending, error, onSave, onDiscard, saveLabel = '保存并离开' }: {
  blocker: Blocker; what: string; canSave: boolean; pending: boolean; error: unknown;
  onSave: (done: () => void) => void; onDiscard?: () => void; saveLabel?: string;
}) {
  const blocked = blocker.state === 'blocked';
  const view = useDialogPresentation(blocked, { what, canSave, pending, error, saveLabel });
  const stay = () => { if (blocked && !pending) blocker.reset(); };
  return <AlertDialog open={blocked} onOpenChange={next => { if (!next) (stay)(); }}><AlertDialogContent className="max-h-[85dvh] overflow-y-auto"><AlertDialogHeader><AlertDialogTitle>{"离开前保存修改？"}</AlertDialogTitle></AlertDialogHeader><AlertDialogDescription asChild><div className="flex flex-col gap-3.5">
    <span className="text-[13.5px] leading-relaxed">{view.what}有未保存的修改。离开后修改会丢失。</span>
    {!view.canSave && <span className="text-[12.5px] text-ink-muted">当前内容有错误，请继续编辑修复，或明确放弃修改。</span>}
    <ErrorAlert error={view.error} />
  </div></AlertDialogDescription><AlertDialogFooter>{<>
    <Button disabled={view.pending} onClick={() => { if (blocked) { onDiscard?.(); blocker.proceed(); } }}>放弃修改</Button>
    <AlertDialogCancel disabled={view.pending}>继续编辑</AlertDialogCancel>
    <Button variant="primary" disabled={!view.canSave || view.pending} onClick={() => onSave(() => { if (blocker.state === 'blocked') blocker.proceed(); })}>{view.pending ? '保存中…' : view.saveLabel}</Button>
  </>}</AlertDialogFooter></AlertDialogContent></AlertDialog>;
}
