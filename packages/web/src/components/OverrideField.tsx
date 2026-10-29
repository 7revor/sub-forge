import { useState } from 'react';
import { stringify } from 'yaml';
import { ExtraFields } from './ExtraFields.tsx';
import { FieldInput, FormSection } from './SchemaForm.tsx';
import { isOverridden, overrideValue } from './override.ts';
import { getPath, otherFields, replaceOtherFields, setPath, type FieldGroup } from './schema.ts';
import { Button } from './ui.tsx';

export function OverrideForm({ groups, base, patch, onChange }: {
  groups: FieldGroup[]; base: Record<string, unknown>; patch: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  // 预设没有值时，点击覆盖也要先展开输入，尚未输入则不向补丁写默认值。
  const [editing, setEditing] = useState<Set<string>>(() => new Set());
  return <div className="flex flex-col gap-4">
    <p className="m-0 text-[13px] text-muted">只保存覆盖项；与预设深度合并，列表整体替换。</p>
    {groups.map((group) => <FormSection key={group.title} title={group.title}><div className="flex flex-col">
        {group.fields.map((field) => {
          const active = isOverridden(patch, field.key) || editing.has(field.key);
          const value = overrideValue(base, patch, field.key);
          return <div key={field.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line-2 py-2.5 last:border-b-0">
            <label htmlFor={`ov-${field.key}`} className="flex min-w-0 flex-[1_1_200px] flex-col gap-0.5">
              <span className="font-mono text-[12.5px]">{field.label}</span>
              {active && field.type === 'lines' && <span className="text-[12px] text-muted">列表整体替换</span>}
            </label>
            <div className="min-w-0 flex-[2_1_260px]">
              {active ? <FieldInput id={`ov-${field.key}`} field={field} value={getPath(patch, field.key)} onChange={(next) => onChange(setPath(patch, field.key, next))} />
                : <div id={`ov-${field.key}`} className="truncate rounded-lg border border-[#d5d9e0] bg-ground px-2.5 py-[7px] font-mono text-[12.5px] text-muted">{value === undefined ? '未设置' : stringify(value, { lineWidth: 0 }).trimEnd().replace(/\n/g, ' · ')}</div>}
            </div>
            <div className="flex flex-[0_0_96px] justify-end">
              <Button size="sm" variant={active ? 'default' : 'ghost'} aria-label={`${active ? '还原' : '覆盖'} ${field.label}`} onClick={() => {
                const next = new Set(editing);
                if (active) next.delete(field.key); else next.add(field.key);
                setEditing(next);
                onChange(setPath(patch, field.key, active ? undefined : getPath(base, field.key)));
              }}>{active ? '还原' : '覆盖'}</Button>
            </div>
          </div>;
        })}
    </div></FormSection>)}
    <ExtraFields value={otherFields(patch, groups)} onChange={(next) => onChange(replaceOtherFields(patch, next, groups))} />
  </div>;
}
