import { useState } from 'react';
import { ChevronRight, FileText, Folder } from 'lucide-react';
import type { CascaderOption } from './listbox.tsx';
import { cx } from './ui.tsx';

/** 目录按需展开；文件点击只触发预览，不创建规则集。 */
export function RuleFileTree({ options, selected, expanded, onSelect }: {
  options: CascaderOption[]; selected?: string; expanded: boolean; onSelect: (value: string) => void;
}) {
  return <ul aria-label="规则目录" className="m-0 list-none p-0">{options.map(option => <TreeNode key={option.value} option={option} depth={0} selected={selected} expanded={expanded} onSelect={onSelect} />)}</ul>;
}

function TreeNode({ option, depth, selected, expanded, onSelect }: {
  option: CascaderOption; depth: number; selected?: string; expanded: boolean; onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(depth === 0 || expanded);
  const directory = option.children !== undefined;
  return <li>
    <button type="button" aria-expanded={directory ? open : undefined} aria-current={!directory && selected === option.value ? 'true' : undefined}
      onClick={() => directory ? setOpen(!open) : onSelect(option.value)} style={{ paddingLeft: 12 + depth * 14 }}
      className={cx('flex w-full cursor-pointer items-start gap-2 border-b border-line-2 py-2.5 pr-3 text-left hover:bg-ground', selected === option.value && 'bg-accent-soft')}>
      {directory ? <ChevronRight size={14} className={cx('mt-0.5 shrink-0 transition-transform', open && 'rotate-90')} /> : <FileText size={14} className="mt-0.5 shrink-0 text-muted" />}
      {directory && <Folder size={14} className="mt-0.5 shrink-0 text-muted" />}
      <span className="min-w-0 flex-1"><span className="block break-all text-[13px] font-medium">{option.label}</span>{!directory && option.hint && <span className="mt-1 block break-all font-mono text-[11px] leading-4 text-muted">{option.hint}</span>}</span>
    </button>
    {directory && open && <ul className="m-0 list-none p-0">{option.children!.map(child => <TreeNode key={child.value} option={child} depth={depth + 1} selected={selected} expanded={expanded} onSelect={onSelect} />)}</ul>}
  </li>;
}
