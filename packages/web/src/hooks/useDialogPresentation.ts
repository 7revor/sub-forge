import { useLayoutEffect, useRef } from 'react';

/**
 * 打开时跟随当前展示值，关闭时保留最后一次已提交渲染的展示值，供 Radix 完成退场。
 * 适用于标题、说明、查询结果、ReactNode；不是可编辑草稿，不能用来回写业务数据。
 * 不复制 ReactNode/回调，不保存 DOM，也不增加动画计时器。重新打开立即展示新值。
 */
export function useDialogPresentation<T>(open: boolean, value: T): T {
  const lastVisible = useRef(value);
  useLayoutEffect(() => {
    if (open) lastVisible.current = value;
  }, [open, value]);
  return open ? value : lastVisible.current;
}
