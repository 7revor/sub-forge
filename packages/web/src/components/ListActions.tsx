import type { ReactNode } from 'react';

/** 列表操作统一右对齐、32px 高度和 8px 间距；危险操作由调用方放在末尾。 */
export function ListActions({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-end gap-2 whitespace-nowrap [&_button]:h-8 [&_button]:px-2.5 [&_a]:h-8 [&_a]:px-2.5">{children}</div>;
}
