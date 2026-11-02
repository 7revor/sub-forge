import { localRuleLines } from '@sub-forge/core';
import { useRef } from 'react';
import { Textarea } from './ui.tsx';

export function LocalRulesInput({ value, onChange, id, placeholder = '每行填写一条规则，不含出口；支持空行和以 # 开头的注释' }: {
  value: string; onChange: (value: string) => void; id?: string; placeholder?: string;
}) {
  const numbers = useRef<HTMLDivElement>(null);
  return <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-input">
    <div className="flex min-w-0 overflow-hidden">
      <div ref={numbers} aria-hidden className="h-[200px] shrink-0 overflow-hidden w-9 bg-card pr-2.5 py-2.5 text-right font-mono text-sm leading-5 text-muted-foreground">{value.split('\n').map((_, i) => <div key={i}>{i + 1}</div>)}</div>
      <Textarea id={id} aria-label="本地规则内容" placeholder={placeholder} value={value} spellCheck={false} wrap="off"
        className="h-[200px] min-w-0 flex-1 resize-none rounded-none border-0 py-2.5 font-mono text-sm leading-5 shadow-none focus-visible:ring-0"
        onScroll={event => { if (numbers.current) numbers.current.scrollTop = event.currentTarget.scrollTop; }} onChange={event => onChange(event.target.value)} />
    </div>
    <div className="flex justify-between border-t border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground"><span>{localRuleLines(value).length} 条有效</span><span>支持 # 注释与空行</span></div>
  </div>;
}
