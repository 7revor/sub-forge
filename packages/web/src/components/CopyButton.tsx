import type { ComponentProps, ReactNode } from 'react';
import { useClipboard } from '../hooks/useClipboard.ts';
import { Button } from './ui.tsx';

export function CopyButton({ text, children = '复制', disabled, ...props }: Omit<ComponentProps<typeof Button>, 'onClick'> & { text: string; children?: ReactNode }) {
  const clipboard = useClipboard(text);
  return <span className="inline-flex min-w-0 flex-col gap-1">
    <Button {...props} disabled={disabled || clipboard.status === 'pending'} onClick={() => void clipboard.copy()}>
      {clipboard.status === 'copied' ? '已复制' : clipboard.status === 'pending' ? '复制中…' : children}
    </Button>
    <span className="sr-only" role="status">{clipboard.status === 'copied' ? '已复制' : ''}</span>
    {clipboard.error && <span role="alert" className="max-w-64 break-words text-[12px] text-err">{clipboard.error}</span>}
  </span>;
}
