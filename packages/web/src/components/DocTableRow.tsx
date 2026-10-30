// 名称与操作保留原生链接，鼠标也可以点击行内的非交互区域进入详情。
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { buttonClass } from './ui.tsx';

// 与设计稿一致：名称为正文色，悬停变为强调色
export const docNameLinkClass = 'font-medium text-ink no-underline hover:text-brand';

/** 行操作列的表头：设计稿中留空，只给读屏提供文字 */
export const actionHeader = <span className="sr-only">操作</span>;

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

/** 行内次要操作：与设计稿表格行里的「编辑」「重置密码」相同的小号次要按钮，不带图标 */
export function DocActionLink({ to, name, viewOnly = false }: { to: string; name: string; viewOnly?: boolean }) {
  const label = viewOnly ? '查看' : '编辑';
  return <Link to={to} aria-label={`${label} ${name}`} className={buttonClass('default', 'sm')}>{label}</Link>;
}
