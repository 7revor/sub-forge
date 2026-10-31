import { createModal, useModalDraft, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '../../modals/index.tsx';
import { Button, Field, Input, Textarea } from '../../components/ui.tsx';
export const ProfileInfoModal = createModal<{ name: string; note?: string }, { name: string; note: string }>(function ProfileInfo({ data, modal }) {
  const [draft, setDraft] = useModalDraft({ name: data.name, note: data.note ?? '' });
  return <ModalContent><ModalHeader><ModalTitle>名称与备注</ModalTitle></ModalHeader>
    <form className="flex flex-col gap-4" onSubmit={event => { event.preventDefault(); if (draft.name.trim()) modal.confirm({ ...draft, name: draft.name.trim() }); }}>
      <Field label="名称">{id => <Input id={id} autoFocus placeholder="例如：日常使用" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} />}</Field>
      <Field label="备注">{id => <Textarea id={id} placeholder="记录用途，可选" value={draft.note} onChange={event => setDraft({ ...draft, note: event.target.value })} />}</Field>
      <ModalFooter><Button onClick={modal.cancel}>取消</Button><Button variant="primary" type="submit" disabled={!draft.name.trim()}>确定</Button></ModalFooter>
    </form>
  </ModalContent>;
});
