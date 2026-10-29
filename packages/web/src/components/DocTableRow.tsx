// 名称与操作保留原生链接，鼠标也可以点击行内的非交互区域进入详情。
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { Pencil, ArrowRight } from 'lucide-react';

export const docNameLinkClass = 'font-medium text-accent no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export function DocTableRow({ to, children }: { to: string; children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <tr className="cursor-pointer hover:bg-ground focus-within:bg-ground" onClick={(event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (event.target instanceof Element && event.target.closest('a, button, input, select, textarea, [role="button"], [contenteditable]')) return;
      if (window.getSelection()?.toString()) return;
      void navigate(to);
    }}>
      {children}
    </tr>
  );
}

export function DocActionLink({ to, name, viewOnly = false }: { to: string; name: string; viewOnly?: boolean }) {
  const Icon = viewOnly ? ArrowRight : Pencil;
  const label = viewOnly ? '查看详情' : '编辑';
  return (
    <Link to={to} aria-label={`${label} ${name}`} className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-line bg-panel px-3 text-[13px] font-medium text-accent no-underline hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
      <Icon size={14} aria-hidden="true" />{label}
    </Link>
  );
}
