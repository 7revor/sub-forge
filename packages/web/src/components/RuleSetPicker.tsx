import type { Matcher } from '@sub-forge/core';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api.ts';
import { ruleOptionsLoader, type RuleSelection } from '../domain/ruleOptions.ts';
import { alertError } from '../feedback.ts';
import { AsyncSelect } from './listbox.tsx';

type RuleSetMatcher = Extract<Matcher, { kind: 'ruleset' }>;
const loadAll = ruleOptionsLoader('all');
const loadRepository = ruleOptionsLoader('repository');

function RuleOptionPicker({ scope = 'all', label, onSelect, ...props }: {
  scope?: 'all' | 'repository'; label: string; onSelect: (selection: RuleSelection) => void;
  id?: string; ariaLabel?: string; disabled?: boolean; triggerClassName?: string; triggerIcon?: ReactNode;
  valueLabel?: string; placeholder?: string; modal?: boolean;
}) {
  return <AsyncSelect {...props} label={label} loadOptions={scope === 'all' ? loadAll : loadRepository} onChange={value => onSelect(JSON.parse(value) as RuleSelection)} />;
}

/** 模板、订阅和本地规则集共用两行分页列表；解析成功前不改动原草稿。 */
export function RuleSetPicker({ onSelect, scope = 'all', label = '引用规则集', ariaLabel = label, id, triggerClassName, triggerIcon, valueLabel, placeholder, modal }: {
  onSelect: (matcher: RuleSetMatcher) => void; scope?: 'all' | 'repository'; label?: string; id?: string;
  ariaLabel?: string; triggerClassName?: string; triggerIcon?: ReactNode;
  valueLabel?: string; placeholder?: string; modal?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const currentSelect = useRef(onSelect);
  currentSelect.current = onSelect;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  return <RuleOptionPicker id={id} label={busy ? '正在读取…' : label} ariaLabel={ariaLabel} disabled={busy} scope={scope}
    triggerClassName={triggerClassName} triggerIcon={triggerIcon} valueLabel={busy ? '正在读取…' : valueLabel} placeholder={placeholder} modal={modal}
    onSelect={async selection => {
      setBusy(true);
      try {
        const result = await api<{ matcher: RuleSetMatcher }>('POST', '/rule-options/resolve', selection);
        if (alive.current) currentSelect.current(result.matcher);
      } catch (error) { if (alive.current) alertError(error); }
      finally { if (alive.current) setBusy(false); }
    }} />;
}
