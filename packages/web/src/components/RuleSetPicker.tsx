import type { Matcher } from '@sub-forge/core';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api.ts';
import { alertError } from '../feedback.ts';
import { AsyncSelect, type AsyncSelectOption, type AsyncSelectPage } from './listbox.tsx';

type RuleSetMatcher = Extract<Matcher, { kind: 'ruleset' }>;
const loader = (scope: 'all' | 'repository') => async (query: string, offset: number): Promise<AsyncSelectPage> => {
  const result = await api<{ items: AsyncSelectOption[]; total: number; notices: string[] }>('GET', `/rule-options/search?scope=${scope}&q=${encodeURIComponent(query)}&offset=${offset}&limit=30`);
  return { options: result.items, notices: result.notices, nextOffset: offset + result.items.length < result.total ? offset + result.items.length : undefined };
};
const loadAll = loader('all');
const loadRepository = loader('repository');

/** 模板引用和本地规则集关联共享搜索、匹配、选择；解析成功前不改动原草稿。 */
export function RuleSetPicker({ onSelect, scope = 'all', label = '引用规则集', ariaLabel = label, id, triggerClassName, triggerIcon }: {
  onSelect: (matcher: RuleSetMatcher) => void; scope?: 'all' | 'repository'; label?: string; id?: string;
  ariaLabel?: string; triggerClassName?: string; triggerIcon?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const currentSelect = useRef(onSelect);
  currentSelect.current = onSelect;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  return <AsyncSelect id={id} aria-label={ariaLabel} placeholder={busy ? '正在读取…' : label} disabled={busy}
    searchLabel={scope === 'all' ? '搜索规则集' : '搜索仓库规则'} searchPlaceholder="搜索名称、仓库或路径"
    triggerClassName={triggerClassName} triggerIcon={triggerIcon} loadOptions={scope === 'all' ? loadAll : loadRepository}
    onChange={async key => {
      setBusy(true);
      try {
        const [source, first, entry] = JSON.parse(key) as string[];
        const result = await api<{ matcher: RuleSetMatcher }>('POST', '/rule-options/resolve', source === 'local' ? { source, id: first } : { source, repo: first, entry });
        if (alive.current) currentSelect.current(result.matcher);
      } catch (error) { if (alive.current) alertError(error); }
      finally { if (alive.current) setBusy(false); }
    }} />;
}
