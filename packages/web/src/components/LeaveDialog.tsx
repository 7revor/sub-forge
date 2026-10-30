import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogFooter, AlertDialogDescription, AlertDialogCancel } from './ui/alert-dialog.tsx';
import type { Blocker } from 'react-router';
import { Button, ErrorAlert, } from './ui.tsx';

export function LeaveDialog({ blocker, what, canSave, pending, error, onSave, onDiscard, saveLabel = '保存并离开' }: {
  blocker: Blocker; what: string; canSave: boolean; pending: boolean; error: unknown;
  onSave: (done: () => void) => void; onDiscard?: () => void; saveLabel?: string;
}) {
  const blocked = blocker.state === 'blocked';
  const stay = () => { if (blocked && !pending) blocker.reset(); };
  return <AlertDialog open={blocked} onOpenChange={next => { if (!next) (stay)(); }}><AlertDialogContent className="max-h-[85dvh] overflow-y-auto"><AlertDialogHeader><AlertDialogTitle>{"离开前保存修改？"}</AlertDialogTitle></AlertDialogHeader><AlertDialogDescription asChild><div className="flex flex-col gap-3.5">
    <span className="text-[13.5px] leading-relaxed">{what}有未保存的修改。离开后修改会丢失。</span>
    {!canSave && <span className="text-[12.5px] text-ink-muted">当前内容有错误，请继续编辑修复，或明确放弃修改。</span>}
    <ErrorAlert error={error} />
  </div></AlertDialogDescription><AlertDialogFooter>{<>
    <Button disabled={pending} onClick={() => { if (blocked) { onDiscard?.(); blocker.proceed(); } }}>放弃修改</Button>
    <AlertDialogCancel disabled={pending}>继续编辑</AlertDialogCancel>
    <Button variant="primary" disabled={!canSave || pending} onClick={() => onSave(() => { if (blocker.state === 'blocked') blocker.proceed(); })}>{pending ? '保存中…' : saveLabel}</Button>
  </>}</AlertDialogFooter></AlertDialogContent></AlertDialog>;
}
