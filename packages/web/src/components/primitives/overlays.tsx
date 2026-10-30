// 采用 shadcn/ui Radix 版的标准动画类；业务层只调整配色、尺寸和布局。
// 来源：https://github.com/shadcn-ui/ui/tree/main/apps/v4/registry/new-york-v4/ui
import type { ComponentProps } from 'react';
import { Dialog, AlertDialog, Popover, DropdownMenu, Select } from 'radix-ui';
import { cx } from '../cx.ts';

export { Dialog, AlertDialog, Popover, DropdownMenu, Select as SelectPrimitive };

export const overlayMotion = 'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 motion-reduce:animate-none!';
export const panelMotion = `${overlayMotion} duration-200 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95`;
export const floatingMotion = `${overlayMotion} data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2`;

export function PopoverContent({ className, align = 'start', sideOffset = 4, collisionPadding = 8, ...props }: ComponentProps<typeof Popover.Content>) {
  return <Popover.Portal><Popover.Content data-slot="popover-content" align={align} sideOffset={sideOffset} collisionPadding={collisionPadding}
    className={cx('z-[60] origin-(--radix-popover-content-transform-origin) rounded-[10px] border border-line bg-panel text-ink shadow-[0_8px_24px_rgba(20,23,28,.12)] outline-none', floatingMotion, className)} {...props} /></Popover.Portal>;
}

export function DropdownMenuContent({ className, sideOffset = 4, collisionPadding = 8, ...props }: ComponentProps<typeof DropdownMenu.Content>) {
  return <DropdownMenu.Portal><DropdownMenu.Content data-slot="dropdown-menu-content" sideOffset={sideOffset} collisionPadding={collisionPadding}
    className={cx('z-[60] max-h-(--radix-dropdown-menu-content-available-height) origin-(--radix-dropdown-menu-content-transform-origin) overflow-y-auto rounded-[10px] border border-line bg-panel p-1.5 text-ink shadow-lg outline-none', floatingMotion, className)} {...props} /></DropdownMenu.Portal>;
}

/** 提交入口可能在请求期间被禁用；这时恢复到仍打开的下层弹窗。 */
export function restoreOverlayFocus(previous: Element | null) {
  if (previous instanceof HTMLElement && previous !== document.body && previous.isConnected && !previous.matches(':disabled') && !previous.closest('[aria-hidden="true"], [inert]')) {
    previous.focus();
    if (document.activeElement === previous) return;
  }
  const underlying = [...document.querySelectorAll<HTMLElement>('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')]
    .filter(element => !element.closest('[aria-hidden="true"], [inert]')).at(-1);
  const target = underlying?.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled), button:not(:disabled), [tabindex="0"]');
  (target ?? underlying)?.focus();
}
