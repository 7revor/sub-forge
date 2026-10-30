import { createModal, ModalContent, ModalHeader, ModalTitle, ModalDescription, ModalFooter } from './index.tsx';
import { Button } from '../components/ui.tsx';
export const LeaveModal = createModal<{ what: string; canSave: boolean; saveLabel?: string }, 'save' | 'discard'>(function Leave({ data, modal }) {
  return <ModalContent><ModalHeader><ModalTitle>离开前保存修改？</ModalTitle><ModalDescription>{data.what}有未保存的修改。离开后修改会丢失。</ModalDescription></ModalHeader>
    {!data.canSave && <p className="text-[13px] text-ink-muted">当前内容有错误，请继续编辑修复，或明确放弃修改。</p>}
    <ModalFooter><Button disabled={modal.pending} onClick={() => modal.confirm('discard')}>放弃修改</Button><Button disabled={modal.pending} onClick={modal.cancel}>继续编辑</Button><Button variant="primary" disabled={modal.pending || !data.canSave} onClick={() => modal.confirm('save')}>{modal.pending ? '保存中…' : data.saveLabel ?? '保存并离开'}</Button></ModalFooter>
  </ModalContent>;
});
