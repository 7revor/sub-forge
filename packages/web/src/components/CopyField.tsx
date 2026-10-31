import { Link2 } from 'lucide-react';
import { CopyButton } from './CopyButton.tsx';
export function CopyField({ value, label = '复制链接' }: { value: string; label?: string }) {
  return <div className="flex h-8 min-w-0 flex-[0_1_560px] items-center gap-2 rounded-lg border border-line bg-panel pl-2.5 pr-0.5">
    <Link2 size={14} className="shrink-0 text-ink-muted" />
    <a href={value} target="_blank" rel="noreferrer" title={value} className="min-w-0 flex-1 truncate font-mono text-[length:var(--text-caption)] text-ink-2 no-underline">{value}</a>
    <CopyButton size="sm" variant="ghost" text={value}>{label}</CopyButton>
  </div>;
}
