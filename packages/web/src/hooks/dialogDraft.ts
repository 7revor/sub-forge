export type DialogSession<T> = { open: boolean; key?: string; generation: number; draft: T };
export type DraftUpdate<T> = T | ((current: T) => T);

export function nextDialogSession<T>(current: DialogSession<T> | undefined, open: boolean, source: T, key?: string): DialogSession<T> {
  if (!current) return { open, key, generation: 0, draft: structuredClone(source) };
  if (open === current.open && (!open || key === current.key)) return current;
  return { open, key, generation: current.generation + 1, draft: open ? structuredClone(source) : current.draft };
}

export function updateDialogSession<T>(current: DialogSession<T>, generation: number, next: DraftUpdate<T>): DialogSession<T> {
  if (!current.open || current.generation !== generation) return current;
  return { ...current, draft: typeof next === 'function' ? (next as (value: T) => T)(current.draft) : next };
}
