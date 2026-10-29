import type { Matcher } from '@sub-forge/core';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type RuleCatalog } from '../api.ts';
import { buildRuleCatalog, type RuleCatalogSelection } from '../domain/ruleCatalog.ts';
import { alertError } from '../feedback.ts';
import { Cascader } from './listbox.tsx';

type RuleSetMatcher = Extract<Matcher, { kind: 'ruleset' }>;
const loader = (scope: 'all' | 'repository') => async (query: string) => {
  const catalog = await api<RuleCatalog>('GET', `/rule-options/catalog?scope=${scope}&q=${encodeURIComponent(query)}`);
  return { options: buildRuleCatalog(catalog), notices: catalog.notices };
};
const loadAll = loader('all');
const loadRepository = loader('repository');

export function RuleCatalogPicker({ scope = 'all', label, onSelect, ...props }: {
  scope?: 'all' | 'repository'; label: string; onSelect: (selection: RuleCatalogSelection) => void;
  id?: string; ariaLabel?: string; disabled?: boolean; triggerClassName?: string; triggerIcon?: ReactNode;
}) {
  return <Cascader {...props} label={label} loadOptions={scope === 'all' ? loadAll : loadRepository} onChange={value => onSelect(JSON.parse(value) as RuleCatalogSelection)} />;
}

/** 模板、订阅和本地规则集共用级联目录；解析成功前不改动原草稿。 */
export function RuleSetPicker({ onSelect, scope = 'all', label = '引用规则集', ariaLabel = label, id, triggerClassName, triggerIcon }: {
  onSelect: (matcher: RuleSetMatcher) => void; scope?: 'all' | 'repository'; label?: string; id?: string;
  ariaLabel?: string; triggerClassName?: string; triggerIcon?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const currentSelect = useRef(onSelect);
  currentSelect.current = onSelect;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  return <RuleCatalogPicker id={id} label={busy ? '正在读取…' : label} ariaLabel={ariaLabel} disabled={busy} scope={scope}
    triggerClassName={triggerClassName} triggerIcon={triggerIcon}
    onSelect={async selection => {
      setBusy(true);
      try {
        const result = await api<{ matcher: RuleSetMatcher }>('POST', '/rule-options/resolve', selection);
        if (alive.current) currentSelect.current(result.matcher);
      } catch (error) { if (alive.current) alertError(error); }
      finally { if (alive.current) setBusy(false); }
    }} />;
}
