// 验收专用入口，复用完整生产应用和唯一 ModalRoot，不进入生产构建。
import { observeDialogExits, type ExitRecord } from './observe-dialog-exit.ts';
const results: ExitRecord[] = [];
const output = document.getElementById('dialog-motion-results')!;
observeDialogExits(record => { results.push(record); output.textContent = JSON.stringify(results); });
const params = new URLSearchParams(location.search);
if (params.get('motion') === 'none') {
  const style = document.createElement('style');
  style.textContent = '[data-slot="dialog-content"], [data-slot="dialog-overlay"] { animation: none !important; }';
  document.head.append(style);
}
const path = params.get('path') ?? '/';
if (!path.startsWith('/') || path.startsWith('//')) throw new Error('验收入口只接受本站页面路径');
history.replaceState(null, '', path);
await import('../src/main.tsx');
