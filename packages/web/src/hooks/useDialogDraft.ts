import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { nextDialogSession, updateDialogSession } from './dialogDraft.ts';

/** 每次打开深拷贝初始值；外部刷新不覆盖本次编辑，关闭保留草稿供退场渲染。 */
export function useDialogDraft<T>(open: boolean, source: T, key?: string): [T, Dispatch<SetStateAction<T>>] {
  const [session, setSession] = useState(() => nextDialogSession(undefined, open, source, key));
  const nextSession = nextDialogSession(session, open, source, key);
  if (nextSession !== session) setSession(nextSession);
  const setDraft = useCallback<Dispatch<SetStateAction<T>>>(next => {
    // 已关闭或被替换的会话，其异步回调不能写入下一次打开的草稿。
    setSession(current => updateDialogSession(current, session.generation, next));
  }, [session.generation]);
  return [session.draft, setDraft];
}
