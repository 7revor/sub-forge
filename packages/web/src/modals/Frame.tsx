import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { createModal, useModalDraft, ModalContent, ModalHeader, ModalTitle, ModalDescription, ModalFooter } from './index.tsx';
import type { ModalActions } from './controller.ts';
import { Button, Field, Input } from '../components/ui.tsx';

type Message = { title: string; description?: string; confirmLabel?: string; danger?: boolean };
type Prompt = Message & { label?: string; placeholder: string; initialValue?: string; minLength?: number; type?: 'text' | 'password'; unchangedValue?: string };
const MessageModal = createModal<Message & { kind: 'confirm' | 'alert' | 'success' | 'error' }, boolean>(function MessageBody({ data, modal }) {
  const Icon = data.kind === 'success' ? CheckCircle2 : data.kind === 'error' || data.danger ? AlertCircle : Info;
  return <ModalContent className="max-h-[85dvh] overflow-y-auto"><ModalHeader><ModalTitle className="flex items-center gap-2"><Icon size={20} aria-hidden className={data.kind === 'error' || data.danger ? 'text-err' : data.kind === 'success' ? 'text-ok' : 'text-brand'} />{data.title}</ModalTitle>
    {data.description && <ModalDescription className="whitespace-pre-wrap break-words">{data.description}</ModalDescription>}</ModalHeader>
    <ModalFooter>{data.kind === 'confirm' && <Button disabled={modal.pending} onClick={modal.cancel}>取消</Button>}<Button variant={data.danger ? 'danger-solid' : 'primary'} disabled={modal.pending} onClick={() => modal.confirm(true)}>{modal.pending ? '处理中…' : data.confirmLabel ?? (data.kind === 'confirm' ? '确认' : '知道了')}</Button></ModalFooter>
  </ModalContent>;
});
const PromptModal = createModal<Prompt, string>(function PromptBody({ data, modal }) {
  const [value, setValue] = useModalDraft(data.initialValue ?? '');
  const text = data.type === 'password' ? value : value.trim();
  const valid = text.length >= (data.minLength ?? 1) && (data.unchangedValue === undefined || text !== data.unchangedValue);
  return <ModalContent><ModalHeader><ModalTitle>{data.title}</ModalTitle>{data.description && <ModalDescription>{data.description}</ModalDescription>}</ModalHeader>
    <form className="flex flex-col gap-4" onSubmit={event => { event.preventDefault(); if (valid) modal.confirm(text); }}>
      <Field label={data.label ?? '名称'}>{id => <Input id={id} autoFocus type={data.type ?? 'text'} autoComplete={data.type === 'password' ? 'new-password' : 'off'} placeholder={data.placeholder} value={value} onChange={event => setValue(event.target.value)} />}</Field>
      <ModalFooter><Button disabled={modal.pending} onClick={modal.cancel}>取消</Button><Button type="submit" variant="primary" disabled={modal.pending || !valid}>{modal.pending ? '处理中…' : data.confirmLabel ?? '保存'}</Button></ModalFooter>
    </form>
  </ModalContent>;
});

/** 简单弹窗的唯一快捷入口，与业务 Modal.show 共用运行时、草稿和退场约定。 */
export const Frame = Object.freeze({ modal: Object.freeze({
  confirm: (data: Message, actions?: ModalActions<boolean>) => MessageModal.show({ ...data, kind: 'confirm' }, actions),
  alert: (data: Message) => MessageModal.show({ ...data, kind: 'alert' }),
  success: (data: Message) => MessageModal.show({ ...data, kind: 'success' }),
  error: (data: Message) => MessageModal.show({ ...data, kind: 'error' }),
  prompt: (data: Prompt, actions?: ModalActions<string>) => PromptModal.show(data, actions),
}) });
