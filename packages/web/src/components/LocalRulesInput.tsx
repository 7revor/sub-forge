import { localRuleLines } from '@sub-forge/core';
import { useRef } from 'react';
import { Textarea } from './ui.tsx';

export function LocalRulesInput({ value, onChange, id, placeholder = '每行填写一条规则，不含出口；支持空行和以 # 开头的注释' }: {
  value: string; onChange: (value: string) => void; id?: string; placeholder?: string;
}) {
  const numbers = useRef<HTMLDivElement>(null);
  return <div className="flex min-w-0 flex-col gap-1.5">
    <div className="flex min-w-0 overflow-hidden rounded-md border border-line focus-within:border-brand">
      <div ref={numbers} aria-hidden className="h-[240px] shrink-0 overflow-hidden bg-ground px-2 py-2 font-mono text-[12.5px] leading-6 text-ink-muted">{value.split('\n').map((_, i) => <div key={i}>{i + 1}</div>)}</div>
      <Textarea id={id} aria-label="本地规则内容" placeholder={placeholder} value={value} spellCheck={false} wrap="off"
        className="h-[240px] min-w-0 flex-1 resize-none rounded-none border-0 py-2 font-mono text-[12.5px] leading-6 focus:ring-0"
        onScroll={event => { if (numbers.current) numbers.current.scrollTop = event.currentTarget.scrollTop; }} onChange={event => onChange(event.target.value)} />
    </div>
    <span className="text-[12px] text-ink-muted">{localRuleLines(value).length} 条规则</span>
  </div>;
}
