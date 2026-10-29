import { useRef, useState } from 'react';
import { ChevronRight, FileText, Folder } from 'lucide-react';
import type { TreeLoader, TreeOption } from './listbox.tsx';
import { OptionPageStatus, useOptionPages } from './OptionPage.tsx';
import { cx } from './cx.ts';

/** 无搜索时折叠，搜索时展开当前页匹配目录；每层后续页仍手动加载。 */
export function RuleFileTree({ loadOptions, query, selected, onSelect, parent, depth = 0, allowUnavailable = false }: {
  loadOptions: TreeLoader; query: string; selected?: string; onSelect: (value: string) => void; parent?: string; depth?: number; allowUnavailable?: boolean;
}) {
  const page = useOptionPages(loadOptions, query, parent);
  return <div>
    <ul role={depth ? 'group' : 'tree'} aria-label={depth ? '子目录' : '规则目录'} aria-busy={page.isFetching} className="m-0 list-none p-0">
      {page.options.map(option => <TreeNode key={option.value} option={option} depth={depth} selected={selected} query={query} loadOptions={loadOptions} onSelect={onSelect} allowUnavailable={allowUnavailable} />)}
    </ul>
    <OptionPageStatus page={page} />
  </div>;
}

function TreeNode({ option, depth, selected, query, loadOptions, onSelect, allowUnavailable }: {
  option: TreeOption; depth: number; selected?: string; query: string; loadOptions: TreeLoader; onSelect: (value: string) => void; allowUnavailable: boolean;
}) {
  const [open, setOpen] = useState(!!query.trim());
  const branch = useRef<HTMLLIElement>(null);
  return <li ref={branch} role="none">
    <button type="button" role="treeitem" disabled={!allowUnavailable && option.disabled} aria-level={depth + 1}
      aria-expanded={option.branch ? open : undefined} aria-selected={!option.branch && selected === option.value}
      onKeyDown={event => {
        if (event.key === 'ArrowRight' && option.branch) {
          event.preventDefault();
          if (!open) setOpen(true);
          else branch.current?.querySelector<HTMLButtonElement>('ul button[role="treeitem"]:not(:disabled)')?.focus();
        }
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          if (option.branch && open) setOpen(false);
          else branch.current?.parentElement?.closest('li')?.querySelector<HTMLButtonElement>('button[role="treeitem"]')?.focus();
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const siblings = [...(branch.current?.closest('[role="tree"]')?.querySelectorAll<HTMLButtonElement>('button[role="treeitem"]:not(:disabled)') ?? [])];
          const next = siblings.indexOf(event.currentTarget) + (event.key === 'ArrowDown' ? 1 : -1);
          siblings[Math.max(0, Math.min(siblings.length - 1, next))]?.focus();
        }
      }}
      onClick={() => option.branch ? setOpen(!open) : onSelect(option.value)} style={{ paddingLeft: 12 + depth * 14 }}
      className={cx('flex w-full cursor-pointer items-start gap-2 border-b border-line-2 py-2.5 pr-3 text-left hover:bg-ground focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45', selected === option.value && 'bg-accent-soft')}>
      {option.branch ? <ChevronRight size={14} className={cx('mt-0.5 shrink-0 transition-transform', open && 'rotate-90')} /> : <FileText size={14} className="mt-0.5 shrink-0 text-muted" />}
      {option.branch && <Folder size={14} className="mt-0.5 shrink-0 text-muted" />}
      <span className="min-w-0 flex-1"><span className="block break-all text-[13px] font-medium">{option.label}</span>{!option.branch && option.hint && <span className="mt-1 block break-all font-mono text-[11px] leading-4 text-muted">{option.hint}</span>}</span>
    </button>
    {option.branch && open && <RuleFileTree parent={option.value} depth={depth + 1} selected={selected} query={query} loadOptions={loadOptions} onSelect={onSelect} allowUnavailable={allowUnavailable} />}
  </li>;
}
