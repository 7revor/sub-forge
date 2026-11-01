import { Field, Input, Textarea } from './ui.tsx';

export function NoteField({ value, onChange, compact = false }: { compact?: boolean; value: string | undefined; onChange: (note: string) => void }) {
  return <Field label="备注">{(id) =>
    <>{compact ? <Input id={id} placeholder="填写用途或其他说明" value={value ?? ''} onChange={event => onChange(event.target.value)} /> : <Textarea id={id} rows={2} placeholder="填写用途或其他说明" value={value ?? ''} onChange={event => onChange(event.target.value)} />}</>
  }</Field>;
}

export function NoteCell({ note }: { note?: string }) {
  return <span title={note} className="block min-w-0 max-w-[320px] truncate text-muted-foreground">{note?.trim() ? note : '无'}</span>;
}
