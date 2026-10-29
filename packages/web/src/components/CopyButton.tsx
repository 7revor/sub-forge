import type { ComponentProps, ReactNode } from 'react';
import { useClipboard } from '../hooks/useClipboard.ts';
import { Button } from './ui.tsx';

export function CopyButton({ text, children = '复制', disabled, ...props }: Omit<ComponentProps<typeof Button>, 'onClick'> & { text: string; children?: ReactNode }) {
  const clipboard = useClipboard(text);
  return <Button {...props} disabled={disabled || clipboard.status === 'pending'} onClick={() => void clipboard.copy()}>
    {clipboard.status === 'pending' ? '复制中…' : children}
  </Button>;
}
