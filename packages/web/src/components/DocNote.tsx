import { Field, Textarea } from './ui.tsx';

export function NoteField({ value, onChange }: { value: string | undefined; onChange: (note: string) => void }) {
  return <Field label="备注">{(id) =>
    <Textarea id={id} rows={2} placeholder="填写用途或其他说明" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  }</Field>;
}

export function NoteCell({ note }: { note?: string }) {
  return <span className="block min-w-[140px] max-w-[320px] whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-ink-2">{note?.trim() ? note : '—'}</span>;
}
