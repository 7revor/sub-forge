import { Empty, formatTime } from '../../components/ui.tsx';

export function VersionHistory({ versions, onCompare, dateOnly = false }: {
  versions: { version: number; createdAt: number; changelog?: string }[]; onCompare: (version: number) => void; dateOnly?: boolean;
}) {
  if (!versions.length) return <Empty title="还没有版本记录" />;
  return <ul className="m-0 flex list-none flex-col p-0">
    {versions.map((v) => <li key={v.version} className="flex flex-col gap-1 border-t border-line-2 py-2.5 first:border-0 first:pt-0">
      <span className="flex justify-between text-[13px]"><span className="font-mono font-semibold">v{v.version}</span><span className="text-[12px] text-muted">{formatTime(v.createdAt).slice(5, dateOnly ? 10 : undefined)}</span></span>
      <span className="text-[12.5px] leading-relaxed text-ink-2">{v.changelog ?? '—'}</span>
      {v.version > 1 && <button type="button" className="w-fit cursor-pointer text-[12.5px] text-accent" onClick={() => onCompare(v.version)}>与上一版对比</button>}
    </li>)}
  </ul>;
}
