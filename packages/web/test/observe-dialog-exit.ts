// 仅用于内置浏览器验收：观察真实 DOM，不改变弹窗、动画或运行时状态。
export type DialogFrame = {
  height: number; width: number; text: string; title: string;
  inputs: { value: string; checked?: boolean }[];
  expanded: (string | null)[]; details: boolean[];
};
export type ExitRecord = {
  session: string; title: string; passed: boolean; mode: '动画' | '无动画';
  baseline: DialogFrame; frames: DialogFrame[]; durationMs: number; error?: string;
};
const selector = '[data-slot="dialog-content"]';
const readFrame = (element: HTMLElement): DialogFrame => ({
  // offset 尺寸排除官方 zoom transform，保留真实内容布局高度。
  height: element.offsetHeight, width: element.offsetWidth,
  title: element.querySelector('[data-slot="dialog-title"]')?.textContent ?? '',
  text: element.textContent ?? '',
  inputs: [...element.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea')].map(input => ({ value: input.value, ...('checked' in input ? { checked: input.checked } : {}) })),
  expanded: [...element.querySelectorAll('[aria-expanded]')].map(item => item.getAttribute('aria-expanded')),
  details: [...element.querySelectorAll('details')].map(item => item.open),
});
export function observeDialogExits(onResult: (record: ExitRecord) => void) {
  type Tracked = { baseline: DialogFrame; frames: DialogFrame[]; mode: ExitRecord['mode']; start?: number; session: string };
  const tracked = new Map<HTMLElement, Tracked>();
  let frame = 0;
  let disposed = false;
  const captureOpen = () => {
    document.querySelectorAll<HTMLElement>(selector).forEach(element => {
      if (element.dataset.state !== 'open') return;
      const style = getComputedStyle(element);
      const mode = style.animationName === 'none' || style.animationDuration.split(',').every(value => parseFloat(value) === 0) ? '无动画' : '动画';
      const old = tracked.get(element);
      tracked.set(element, { baseline: readFrame(element), frames: old?.frames ?? [], mode, session: element.dataset.modalSession ?? '' });
    });
  };
  const inspect = () => {
    frame = 0;
    let closing = false;
    for (const [element, state] of tracked) {
      if (!element.isConnected) {
        tracked.delete(element);
        const changed = state.frames.find(value => JSON.stringify(value) !== JSON.stringify(state.baseline));
        const error = changed ? '退场期间内容或布局改变' : state.mode === '动画' && !state.frames.length ? '有动画但未采到 closed 帧' : undefined;
        onResult({ session: state.session, title: state.baseline.title, passed: !error, mode: state.mode, baseline: state.baseline, frames: state.frames, durationMs: state.start === undefined ? 0 : performance.now() - state.start, ...(error ? { error } : {}) });
      } else if (element.dataset.state === 'closed') {
        state.start ??= performance.now();
        state.frames.push(readFrame(element));
        closing = true;
      }
    }
    if (closing && !disposed) frame = requestAnimationFrame(inspect);
  };
  const observe = () => { captureOpen(); if (!frame) inspect(); };
  const observer = new MutationObserver(observe);
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  document.addEventListener('pointerdown', captureOpen, true);
  document.addEventListener('keydown', captureOpen, true);
  document.addEventListener('input', captureOpen, true);
  captureOpen();
  return () => {
    disposed = true; observer.disconnect(); cancelAnimationFrame(frame);
    document.removeEventListener('pointerdown', captureOpen, true);
    document.removeEventListener('keydown', captureOpen, true);
    document.removeEventListener('input', captureOpen, true);
  };
}
