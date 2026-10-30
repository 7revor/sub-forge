import type { ReactNode } from 'react';
import { Button, FieldError, cx } from './ui.tsx';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog.tsx';

/** 三处规则编辑共用模板弹窗的尺寸、分区与默认动画。 */
export function RuleEditShell({ title, description, saveHint, error, children, onApply, onClose, tall = false }: {
  tall?: boolean; title: string; description: string; saveHint: string; error?: string; children: ReactNode; onApply: () => void; onClose: () => void;
}) {
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className={cx('flex min-w-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-lg', tall ? 'h-[min(600px,85dvh)]' : 'h-[min(460px,85dvh)]')}>
      <DialogHeader className="shrink-0 border-b border-line-2 px-5 py-4 text-left sm:px-6">
        <DialogTitle className="pr-6 text-[16px] leading-6">{title}</DialogTitle>
        <DialogDescription className="text-[12.5px]">{description}</DialogDescription>
      </DialogHeader>
      <form noValidate className="flex min-h-0 min-w-0 flex-1 flex-col" onSubmit={event => { event.preventDefault(); onApply(); }}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6 [&>*]:min-w-0">
          {children}<FieldError error={error} />
        </div>
        <DialogFooter className="shrink-0 flex-row flex-wrap items-center justify-end border-t border-line-2 bg-ground px-5 py-3 sm:px-6">
          <span className="mr-auto basis-full text-[12px] text-ink-muted sm:basis-auto">{saveHint}</span>
          <Button onClick={onClose}>取消</Button><Button type="submit" variant="primary">应用</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
