import type { ReactNode } from 'react';

/** 列表操作统一右对齐、8px 间距；危险操作由调用方放在末尾。 */
export function ListActions({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-end gap-2 whitespace-nowrap">{children}</div>;
}
