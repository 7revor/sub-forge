import { useCallback, useEffect, useRef } from 'react';
import { useBeforeUnload, useBlocker, useLocation, useNavigate, type BlockerFunction, type NavigateOptions } from 'react-router';
import { LeaveModal } from '../modals/LeaveModal.tsx';

const changedPath: BlockerFunction = ({ currentLocation, nextLocation }) => currentLocation.pathname !== nextLocation.pathname;

/** 统一路由及刷新保护；调用方决定哪些跳转会丢失自己的草稿。 */
export function useLeaveGuard(enabled: boolean, shouldBlock: BlockerFunction = changedPath, confirmation?: () => { what: string; canSave: boolean; saveLabel?: string; onSave: () => Promise<unknown>; onDiscard?: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const skip = useRef(false);
  useEffect(() => { skip.current = false; }, [location.key]);
  const blocker = useBlocker((transition) => enabled && !skip.current && shouldBlock(transition));
  const confirming = useRef(false);
  useEffect(() => {
    if (blocker.state !== 'blocked' || !confirmation || confirming.current) return;
    const { onSave, onDiscard, ...data } = confirmation();
    confirming.current = true;
    void LeaveModal.show(data, { submit: async choice => { if (choice === 'save') await onSave(); } }).then(result => {
      confirming.current = false;
      if (result.status === 'confirmed') { if (result.data === 'discard') onDiscard?.(); blocker.proceed(); }
      else blocker.reset();
    });
  }, [blocker, confirmation]);
  useBeforeUnload(useCallback((event) => {
    if (enabled && !skip.current) { event.preventDefault(); event.returnValue = ''; }
  }, [enabled]));
  /** 仅供保存或删除成功后的主动跳转，普通导航仍走路由拦截。 */
  const leave = (to: string, options?: NavigateOptions) => { skip.current = true; void navigate(to, options); };
  return { blocker, leave };
}
