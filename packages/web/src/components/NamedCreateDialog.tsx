import { createModal, useModalDraft, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '../modals/index.tsx';
import { Button, Field, Input } from './ui.tsx';
export const NamedCreateDialog = createModal<{ title: string; label?: string; placeholder: string; note?: boolean }, { name: string; note: string }>(function NamedCreate({ data, modal }) {
  const [draft, setDraft] = useModalDraft({ name: '', note: '' });
  return <ModalContent><ModalHeader><ModalTitle>{data.title}</ModalTitle></ModalHeader>
    <form className="flex flex-col gap-4" onSubmit={event => { event.preventDefault(); if (draft.name.trim()) modal.confirm({ ...draft, name: draft.name.trim() }); }}>
      <Field label={data.label ?? '名称'}>{id => <Input id={id} autoFocus required placeholder={data.placeholder} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />}</Field>
      {data.note && <Field label="备注">{id => <Input id={id} placeholder="填写备注，便于区分和查找" value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })} />}</Field>}
      <ModalFooter><Button disabled={modal.pending} onClick={modal.cancel}>取消</Button><Button type="submit" variant="primary" disabled={!draft.name.trim() || modal.pending}>{modal.pending ? '创建中…' : '创建'}</Button></ModalFooter>
    </form>
  </ModalContent>;
});
