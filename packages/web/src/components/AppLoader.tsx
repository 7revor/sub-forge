// 全屏加载：标志的 S 线条循环描绘，到达后点亮出口节点；延迟淡入，响应很快时不闪烁。

import { LogoMark } from './LogoMark.tsx';

export function AppLoader() {
  return (
    <div role="status" className="app-loader flex h-dvh min-h-0 flex-col items-center justify-center gap-5">
      <div className="relative">
        <span aria-hidden="true" className="app-loader-ripple absolute inset-0 rounded-2xl border-2 border-primary" />
        <LogoMark size={64} animated className="relative block" />
      </div>
      <div className="flex flex-col items-center gap-1">
        <span className="font-mono text-base font-semibold text-foreground">Sub Forge</span>
        <span className="text-sm text-muted-foreground">加载中…</span>
      </div>
    </div>
  );
}
