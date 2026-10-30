import { Component, createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ComponentType, type Dispatch, type SetStateAction, type ReactNode } from 'react';
import { Outlet, useLocation } from 'react-router';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../components/ui/dialog.tsx';
import { ModalController, type ModalActions, type Session } from './controller.ts';
export type { ModalResult } from './controller.ts';

export const modalController = new ModalController();
export type ModalControl<R> = { cancel: () => void; confirm: (value: R) => void; submit: (work: () => R | Promise<R>) => Promise<void>; pending: boolean; error?: string; active: boolean; signal: AbortSignal };
export type ModalProps<P, R> = { data: P; modal: ModalControl<R> };
export function createModal<P, R = void>(Body: ComponentType<ModalProps<P, R>>) {
  return Object.freeze({ show: (data: P, actions?: ModalActions<R>) => modalController.show<P, R>(Body, data, actions) });
}
const SessionContext = createContext<Session | null>(null);
function useSession() { const session = useContext(SessionContext); if (!session) throw new Error('弹窗内容只能通过静态 show() 打开'); return session; }

/** 业务草稿只在本会话存活时可写，关闭和过期异步响应不能再修改它。 */
export function useModalDraft<T>(): [T | undefined, Dispatch<SetStateAction<T | undefined>>];
export function useModalDraft<T>(initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>];
export function useModalDraft<T>(initial?: T | (() => T)) {
  const session = useSession();
  const [value, setValue] = useState<T | undefined>(() => structuredClone(typeof initial === 'function' ? (initial as () => T)() : initial));
  const update = useCallback((next: SetStateAction<T | undefined>) => { if (modalController.active(session.id)) setValue(next); }, [session.id]);
  return [value, update];
}
/** 查询结果在关闭时保留最后一次展示；业务数据仍由独立草稿管理。 */
export function useModalPresentation<T>(value: T): T {
  const session = useSession(); const last = useRef(value);
  useLayoutEffect(() => { if (session.phase === 'open') last.current = value; });
  return session.phase === 'open' ? value : last.current;
}

export function ModalContent(props: React.ComponentProps<typeof DialogContent>) {
  const session = useSession(); const attached = useRef<HTMLElement | null>(null);
  const view = useModalPresentation({ error: session.error });
  // Radix Presence 负责 animationend / 无动画卸载。微任务只排除 StrictMode 的同步重挂载，不猜测动画时长。
  const ref = useRef((node: HTMLDivElement | null) => {
    attached.current = node;
    if (!node) queueMicrotask(() => { if (!attached.current) modalController.exited(session.id); });
  }).current;
  return <DialogContent aria-describedby={undefined} {...props} ref={ref} onCloseAutoFocus={event => { event.preventDefault(); props.onCloseAutoFocus?.(event); }}>
    <fieldset disabled={session.pending || session.phase === 'closing'} className="m-0 contents border-0 p-0">{props.children}</fieldset>
    {view.error && <p role="alert" className="m-0 whitespace-pre-wrap text-[13px] text-err">{view.error}</p>}
  </DialogContent>;
}
export { DialogHeader as ModalHeader, DialogTitle as ModalTitle, DialogDescription as ModalDescription, DialogFooter as ModalFooter };

function ModalInstance({ session }: { session: Session }) {
  const Body = session.definition as ComponentType<ModalProps<unknown, unknown>>;
  const display = useRef({ pending: session.pending, error: session.error });
  useLayoutEffect(() => { if (session.phase === 'open') display.current = { pending: session.pending, error: session.error }; });
  const view = session.phase === 'open' ? session : display.current;
  const modal: ModalControl<unknown> = { cancel: () => modalController.cancel(session.id), confirm: value => modalController.confirm(session.id, value),
    submit: work => modalController.submit(session.id, work), pending: view.pending, error: view.error, active: session.phase === 'open', signal: session.abort.signal };
  return <SessionContext.Provider value={session}><Dialog open={session.phase === 'open'} onOpenChange={open => { if (!open) modal.cancel(); }}><ModalErrorBoundary><Body data={session.data} modal={modal} /></ModalErrorBoundary></Dialog></SessionContext.Provider>;
}
class ModalErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  override state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  override render() {
    return this.state.error ? <ModalContent><DialogHeader><DialogTitle>弹窗无法显示</DialogTitle></DialogHeader><p role="alert">{this.state.error.message}</p></ModalContent> : this.props.children;
  }
}
export function ModalHost() {
  const sessions = useSyncExternalStore(modalController.subscribe, modalController.getSnapshot);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; queueMicrotask(() => { if (!mounted.current) modalController.cancelAll('unmounted', true); }); }; }, []);
  return <>{sessions.map(session => <ModalInstance key={session.id} session={session} />)}</>;
}
export function ModalRoot() {
  const location = useLocation(); const previous = useRef(location.key);
  useLayoutEffect(() => { if (previous.current !== location.key) { modalController.cancelAll('navigation'); previous.current = location.key; } }, [location.key]);
  return <><Outlet /><ModalHost /></>;
}
