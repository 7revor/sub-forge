import type { ReactNode } from 'react';
import { Button, FieldError, cx } from './ui.tsx';
import { ModalContent, ModalDescription, ModalFooter, ModalHeader, ModalTitle } from '../modals/index.tsx';

/** 仅复用规则表单的布局；创建、状态与退场全部由统一 Modal 运行时负责。 */
export function RuleEditShell({ title, description, error, children, onApply, onClose, tall = false, width = 520, confirmLabel = '保存', footer }: {
  width?: 440 | 520; confirmLabel?: string; footer?: ReactNode; tall?: boolean; title: string; description?: string; error?: string; children: ReactNode; onApply: () => void; onClose: () => void;
}) {
  return <>
    <ModalContent className={cx('flex max-h-[85dvh] min-w-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-[520px]', width === 440 && 'sm:max-w-[440px]', tall && 'h-[min(600px,85dvh)]')}>
      <ModalHeader className={cx('shrink-0 px-5 text-left sm:px-6', 'pt-5 pb-4')}>
        <ModalTitle className="pr-6 text-[length:var(--text-section)] leading-6">{title}</ModalTitle>
        {description && <ModalDescription className="text-[length:var(--text-control)]">{description}</ModalDescription>}
      </ModalHeader>
      <form noValidate className="flex min-h-0 min-w-0 flex-1 flex-col" onSubmit={event => { event.preventDefault(); onApply(); }}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-5 pb-5 sm:px-6 [&>*]:min-w-0">
          {children}<FieldError error={error} />
        </div>
        <ModalFooter className="shrink-0 flex-row flex-wrap items-center justify-end border-t border-line-2 bg-ground px-5 py-3 sm:px-6">

          {footer}<Button onClick={onClose}>取消</Button><Button type="submit" variant="primary">{confirmLabel}</Button>
        </ModalFooter>
      </form>
    </ModalContent>
  </>;
}
