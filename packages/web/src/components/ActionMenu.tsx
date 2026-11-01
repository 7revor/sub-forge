import { MoreHorizontal } from 'lucide-react';
import { Children, isValidElement, useState, type ReactNode } from 'react';
import { Button } from './ui.tsx';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from './ui/dropdown-menu.tsx';

export type MenuAction = { label: string; onSelect: () => void; disabled?: boolean; danger?: boolean };
/** 行内和页头共用更多菜单；保留原有按钮的异步行为与确认弹窗入口。 */
export function ActionMenu({ label = '更多操作', items, children, size = 'sm' }: { label?: string; items?: MenuAction[]; children?: ReactNode; size?: 'sm' | 'md' }) {
  const [open, setOpen] = useState(false);
  return <DropdownMenu open={open} onOpenChange={setOpen}>
    <DropdownMenuTrigger asChild><Button size={size} variant={size === 'md' ? 'default' : 'ghost'} className={size === 'md' ? 'w-9 px-0' : 'w-7 px-0'} aria-label={label} title={label}><MoreHorizontal size={16} /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="min-w-48" onClick={event => {
      const target = (event.target as HTMLElement).closest('button,a');
      if (target && !target.hasAttribute('disabled')) setOpen(false);
    }}>
      {items?.filter(item => !item.danger).map(item => <DropdownMenuItem key={item.label} disabled={item.disabled} onSelect={item.onSelect}>{item.label}</DropdownMenuItem>)}
      {Children.toArray(children).filter(isValidElement).map((child, i) => <DropdownMenuItem key={i} className="p-0 [&_button]:h-auto [&_button]:w-full [&_button]:justify-start [&_button]:rounded-md [&_button]:border-0 [&_button]:bg-transparent [&_button]:px-2 [&_button]:py-2 [&_a]:block [&_a]:w-full [&_a]:border-0 [&_a]:px-2 [&_a]:py-2 [&>span]:w-full" onKeyDown={event => {
        if (!['Enter', ' '].includes(event.key)) return;
        const target = event.currentTarget.querySelector<HTMLButtonElement | HTMLAnchorElement>('button,a');
        if (target && !target.hasAttribute('disabled')) { event.preventDefault(); target.click(); setOpen(false); }
      }}>{child}</DropdownMenuItem>)}
      {!!items?.some(item => item.danger) && <DropdownMenuSeparator />}
      {items?.filter(item => item.danger).map(item => <DropdownMenuItem key={item.label} disabled={item.disabled} onSelect={item.onSelect} className="text-destructive focus:text-destructive">{item.label}</DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}
