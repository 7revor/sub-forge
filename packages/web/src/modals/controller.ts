export type CancelReason = 'dismissed' | 'navigation' | 'unmounted';
export type ModalResult<R> = { status: 'confirmed'; data: R } | { status: 'cancelled'; reason: CancelReason };
export type ModalActions<R> = { submit?: (value: R, signal: AbortSignal) => void | Promise<void> };
export type Session<P = unknown, R = unknown> = {
  id: number; definition: unknown; data: P; phase: 'open' | 'closing'; pending: boolean; error?: string;
  result?: ModalResult<R>; actions: ModalActions<R>; abort: AbortController;
  resolve: (result: ModalResult<R>) => void; focus?: HTMLElement;
};

/** 纯控制器：一次调用对应一次会话，确认结果只在实际退场后交付。 */
export class ModalController {
  private nextId = 0;
  private sessions: Session<any, any>[] = [];
  private listeners = new Set<() => void>();
  getSnapshot = () => this.sessions;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish() { this.sessions = [...this.sessions]; this.listeners.forEach(listener => listener()); }
  show<P, R>(definition: unknown, data: P, actions: ModalActions<R> = {}): Promise<ModalResult<R>> {
    const snapshot = structuredClone(data);
    return new Promise(resolve => {
      this.sessions.push({ id: ++this.nextId, definition, data: snapshot, phase: 'open', pending: false, actions, resolve,
        abort: new AbortController(), focus: typeof document === 'undefined' ? undefined : document.activeElement as HTMLElement });
      this.publish();
    });
  }
  active(id: number) { return this.sessions.some(s => s.id === id && s.phase === 'open'); }
  confirm<R>(id: number, value: R) {
    const session = this.sessions.find(s => s.id === id);
    if (!session || session.phase !== 'open' || session.pending) return;
    if (session.actions.submit) { void this.submit(id, () => value); return; }
    session.result = { status: 'confirmed', data: structuredClone(value) };
    session.phase = 'closing'; this.publish();
  }
  cancel(id: number, reason: CancelReason = 'dismissed') {
    const session = this.sessions.find(s => s.id === id);
    if (!session || session.phase !== 'open' || (session.pending && reason === 'dismissed')) return;
    session.abort.abort();
    session.result = { status: 'cancelled', reason }; session.phase = 'closing'; this.publish();
  }
  async submit<R>(id: number, work: () => R | Promise<R>) {
    const session = this.sessions.find(s => s.id === id);
    if (!session || session.phase !== 'open' || session.pending) return;
    session.pending = true; this.publish();
    try {
      const value = structuredClone(await work());
      if (!this.active(id)) return;
      await session.actions.submit?.(value, session.abort.signal);
      if (!this.active(id)) return;
      session.result = { status: 'confirmed', data: structuredClone(value) }; session.phase = 'closing';
    } catch (error) {
      if (this.active(id)) session.error = error instanceof Error ? error.message : String(error);
    } finally {
      // 关闭期间保留最后一次完整展示，不清空 loading、错误或业务草稿。
      if (this.active(id)) session.pending = false;
      this.publish();
    }
  }
  exited(id: number) {
    const session = this.sessions.find(s => s.id === id);
    if (!session || session.phase !== 'closing' || !session.result) return;
    this.sessions = this.sessions.filter(s => s !== session); session.abort.abort(); this.publish();
    session.resolve(session.result);
    if (!this.sessions.some(s => s.id > id) && session.focus?.isConnected) session.focus.focus();
  }
  cancelAll(reason: CancelReason, immediate = false) {
    for (const session of [...this.sessions]) { this.cancel(session.id, reason); if (immediate) this.exited(session.id); }
  }
}
