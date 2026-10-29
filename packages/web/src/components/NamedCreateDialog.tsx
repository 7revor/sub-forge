import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button, ErrorAlert, Field, Input, Modal } from './ui.tsx';

/** 创建请求和跳转由调用方负责；按钮和回车共用一次提交入口。 */
export function NamedCreateDialog({ open, onClose, title, label = '名称', placeholder, hint, pending, error, onCreate, onReset, children }: {
  open: boolean; onClose: () => void; title: string; label?: string; placeholder?: string; hint?: ReactNode;
  children?: ReactNode;
  pending: boolean; error: unknown; onCreate: (name: string) => Promise<unknown>; onReset: () => void;
}) {
  const [name, setName] = useState('');
  const [submitError, setSubmitError] = useState<unknown>();
  const submitting = useRef(false);
  const formId = useId();
  useEffect(() => { if (open) { setName(''); setSubmitError(undefined); onReset(); } }, [open, onReset]);
  const close = () => { if (!pending && !submitting.current) onClose(); };
  return <Modal title={title} open={open} onClose={close} footer={<>
    <Button disabled={pending} onClick={close}>取消</Button>
    <Button type="submit" form={formId} variant="primary" disabled={!name.trim() || pending}>{pending ? '创建中…' : '创建'}</Button>
  </>}>
    <form id={formId} className="flex flex-col gap-3.5" onSubmit={async (event) => {
      event.preventDefault();
      if (!name.trim() || pending || submitting.current) return;
      submitting.current = true;
      setSubmitError(undefined);
      try { await onCreate(name.trim()); }
      catch (error) { setSubmitError(error); }
      finally { submitting.current = false; }
    }}>
      <Field label={label}>{(id) => <Input id={id} autoFocus required disabled={pending} placeholder={placeholder} value={name} onChange={(event) => setName(event.target.value)} />}</Field>
      {children}
      {hint && <span className="text-[12px] text-muted">{hint}</span>}
      <ErrorAlert error={submitError ?? error} />
    </form>
  </Modal>;
}
