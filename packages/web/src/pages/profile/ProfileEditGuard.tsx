import { useCallback } from 'react';
import { useBeforeUnload, useBlocker } from 'react-router';
import { Button, ErrorBox } from '../../components/ui.tsx';

/** 无效原始文本尚未写入草稿，保存/导航都必须等用户修复或明确放弃。 */
export function ProfileEditGuard({ valid, onDiscard }: { valid: boolean; onDiscard: () => void }) {
  const blocker = useBlocker(!valid);
  useBeforeUnload(useCallback((event) => {
    if (!valid) { event.preventDefault(); event.returnValue = ''; }
  }, [valid]));
  if (valid) return null;
  return <div className="flex flex-col gap-2" role="alert">
    <ErrorBox error="基础设置中的 YAML 尚有错误，请修复或放弃修改后再保存。" />
    {blocker.state === 'blocked' && <div className="flex flex-wrap items-center gap-2">
      <span className="text-[13px]">离开会丢失未保存的内容。</span>
      <Button onClick={() => blocker.reset()}>留在页面修复</Button>
      <Button variant="danger" onClick={() => { onDiscard(); blocker.proceed(); }}>放弃未保存内容并离开</Button>
    </div>}
  </div>;
}
