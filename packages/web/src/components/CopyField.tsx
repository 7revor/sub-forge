import { Link2 } from 'lucide-react';
import { CopyButton } from './CopyButton.tsx';
export function CopyField({ value, label = '复制链接' }: { value: string; label?: string }) {
  return <div className="flex h-8 min-w-0 flex-[0_1_560px] items-center gap-2 rounded-lg border border-border bg-card pl-2.5 pr-0.5">
    <Link2 size={14} className="shrink-0 text-muted-foreground" />
    <a href={value} target="_blank" rel="noreferrer" title={value} className="min-w-0 flex-1 truncate font-mono text-xs text-foreground no-underline">{value}</a>
    <CopyButton size="sm" variant="ghost" text={value}>{label}</CopyButton>
  </div>;
}
