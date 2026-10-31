import { Field, Textarea } from './ui.tsx';

export function NoteField({ value, onChange, compact = false }: { compact?: boolean; value: string | undefined; onChange: (note: string) => void }) {
  return <Field label="备注">{(id) =>
    <Textarea id={id} rows={compact ? 1 : 2} className={compact ? 'h-9 min-h-9 resize-none py-[7px]' : undefined} placeholder="填写用途或其他说明" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  }</Field>;
}

export function NoteCell({ note }: { note?: string }) {
  return <span title={note} className="block min-w-0 max-w-[320px] truncate text-ink-muted">{note?.trim() ? note : '无'}</span>;
}
