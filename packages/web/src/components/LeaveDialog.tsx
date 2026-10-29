import type { Blocker } from 'react-router';
import { Button, ErrorBox, Modal } from './ui.tsx';

export function LeaveDialog({ blocker, what, canSave, pending, error, onSave, onDiscard, saveLabel = '保存并离开' }: {
  blocker: Blocker; what: string; canSave: boolean; pending: boolean; error: unknown;
  onSave: (done: () => void) => void; onDiscard?: () => void; saveLabel?: string;
}) {
  const blocked = blocker.state === 'blocked';
  const stay = () => { if (blocked && !pending) blocker.reset(); };
  return <Modal title="离开前保存修改？" open={blocked} onClose={stay} footer={<>
    <Button disabled={pending} onClick={() => { if (blocked) { onDiscard?.(); blocker.proceed(); } }}>放弃修改</Button>
    <Button disabled={pending} onClick={stay}>继续编辑</Button>
    <Button variant="primary" disabled={!canSave || pending} onClick={() => onSave(() => { if (blocker.state === 'blocked') blocker.proceed(); })}>{pending ? '保存中…' : saveLabel}</Button>
  </>}>
    <span className="text-[13.5px] leading-relaxed">{what}有未保存的修改。离开后修改会丢失。</span>
    {!canSave && <span className="text-[12.5px] text-muted">当前内容有错误，请继续编辑修复，或明确放弃修改。</span>}
    <ErrorBox error={error} />
  </Modal>;
}
