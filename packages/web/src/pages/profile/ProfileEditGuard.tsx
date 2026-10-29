import { useLeaveGuard } from '../../hooks/useLeaveGuard.ts';
import { Button, FieldError } from '../../components/ui.tsx';

/** 无效原始文本尚未完整写入草稿，先返回表单恢复有效字段、修复原文或明确放弃。 */
export function ProfileEditGuard({ valid, onDiscard }: { valid: boolean; onDiscard: () => void }) {
  const { blocker } = useLeaveGuard(!valid, () => true);
  if (valid) return null;
  return <div className="flex flex-col gap-2" role="alert">
    <FieldError error="基础设置中的 YAML 尚有错误，可返回表单保留有效字段，或修复原文后保存。" />
    {blocker.state === 'blocked' && <div className="flex flex-wrap items-center gap-2">
      <span className="text-[13px]">离开会丢失未保存的内容。</span>
      <Button onClick={() => blocker.reset()}>留在页面修复</Button>
      <Button variant="danger" onClick={() => { onDiscard(); blocker.proceed(); }}>放弃未保存内容并离开</Button>
    </div>}
  </div>;
}
