import { useEffect, useRef, useState, type ReactNode } from 'react';

/** 退场时保留最后一次打开的内容；重新打开或卸载会取消旧计时器。 */
export function Presence({ open, children }: { open: boolean; children: (open: boolean) => ReactNode }) {
  const [present, setPresent] = useState(open);
  const render = useRef(children);
  if (open) render.current = children;
  useEffect(() => {
    if (open) { setPresent(true); return; }
    // 与 index.css 的退场时长一致；减少动态效果时立即卸载。
    const timer = setTimeout(() => setPresent(false), window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160);
    return () => clearTimeout(timer);
  }, [open]);
  return open || present ? render.current(open) : null;
}
