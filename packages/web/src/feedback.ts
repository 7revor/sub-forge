import { deleteErrorText } from './domain/deleteError.ts';

export type FeedbackAction = { label: string; run: () => void };
export type Feedback = { id: number; kind: 'success' | 'error'; message: string; action?: FeedbackAction };
let nextId = 0;
let items: Feedback[] = [];
const listeners = new Set<() => void>();
const reportedErrors = new WeakSet<object>();
const emit = () => listeners.forEach(listener => listener());

/** 全局队列跨路由保留；同一个错误被多个表单观察时只报告一次。 */
export const feedbackStore = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  getSnapshot: () => items,
  dismiss(id: number) { items = items.filter(item => item.id !== id); emit(); },
};
export function notifySuccess(message: string, action?: FeedbackAction) {
  const id = ++nextId;
  items = [...items, { id, kind: 'success', message, ...(action ? { action } : {}) }];
  emit();
  return id;
}
export function alertError(error: unknown) {
  if (!error) return;
  if (typeof error === 'object') {
    if (reportedErrors.has(error)) return;
    reportedErrors.add(error);
  }
  const message = deleteErrorText(error) || String(error);
  // 同时失败的多个请求合并相同内容；关闭后新操作仍可再次报告。
  if (items.some(item => item.kind === 'error' && item.message === message)) return;
  items = [...items, { id: ++nextId, kind: 'error', message }];
  emit();
}
