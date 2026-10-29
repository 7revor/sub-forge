import { describe, expect, it } from 'vitest';
import { cx } from './ui.tsx';

describe('cx', () => {
  it('后传入的宽、高、字号类覆盖先前的', () => {
    expect(cx('h-[38px] w-full px-3 text-[13px]', 'h-9 w-auto text-[12.5px]')).toBe('h-9 w-auto px-3 text-[12.5px]');
  });

  it('字体颜色与 max-w / min-w 不算冲突', () => {
    expect(cx('text-[13px] w-full', 'text-[#8f2a1f] max-w-[420px] min-w-40')).toBe('text-[13px] w-full text-[#8f2a1f] max-w-[420px] min-w-40');
  });

  it('不同断点各自比较，并丢弃假值', () => {
    expect(cx('w-full md:w-auto', false, undefined, 'md:w-60')).toBe('w-full md:w-60');
  });
});
