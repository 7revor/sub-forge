import type { ComponentProps, ReactNode } from 'react';
import { useClipboard } from '../hooks/useClipboard.ts';
import { Button } from './ui.tsx';

export function CopyButton({ text, children = '复制', disabled, ...props }: Omit<ComponentProps<typeof Button>, 'onClick'> & { text: string; children?: ReactNode }) {
  const clipboard = useClipboard(text);
  return <Button {...props} disabled={disabled || clipboard.status === 'pending'} onClick={() => void clipboard.copy()}>
    <span aria-live="polite" aria-atomic="true" className="inline-flex items-center gap-2">{clipboard.status === 'pending' ? '复制中…' : clipboard.status === 'copied' ? '已复制' : children}</span>
  </Button>;
}
