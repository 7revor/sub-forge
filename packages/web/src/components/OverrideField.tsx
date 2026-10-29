import { useState } from 'react';
import { stringify } from 'yaml';
import { ExtraFields } from './ExtraFields.tsx';
import { FieldInput } from './SchemaForm.tsx';
import { isOverridden, overrideValue } from './override.ts';
import { getPath, otherFields, replaceOtherFields, setPath, type FieldGroup } from './schema.ts';

/** 设计稿「Profile · 基础设置」：每个分区一张卡片，每行「键 | 值 | 覆盖 · 还原 / 来自预设」 */
export function OverrideForm({ groups, base, patch, onChange }: {
  groups: FieldGroup[]; base: Record<string, unknown>; patch: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  // 预设没有值时，点击覆盖也要先展开输入，尚未输入则不向补丁写默认值。
  const [editing, setEditing] = useState<Set<string>>(() => new Set());
  return <div className="flex flex-col gap-4">
    {groups.map((group) => <section key={group.title} data-section={group.title} className="rounded-[10px] border border-line bg-panel">
      <h3 className="m-0 border-b border-line-2 px-4.5 py-3.5 text-[14px] font-semibold">{group.title}</h3>
      <div className="flex flex-col">
        {group.fields.map((field) => {
          const active = isOverridden(patch, field.key) || editing.has(field.key);
          const value = overrideValue(base, patch, field.key);
          return <div key={field.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[#f0f2f5] px-4.5 py-2.5 last:border-b-0">
            <label htmlFor={`ov-${field.key}`} className="flex min-w-0 flex-[1_1_200px] flex-col gap-0.5">
              <span className="font-mono text-[12.5px]">{field.label}</span>
              {active && field.type === 'lines' && <span className="text-[12px] text-muted">列表整体替换</span>}
            </label>
            <div className="min-w-0 flex-[2_1_260px]">
              {active ? <FieldInput id={`ov-${field.key}`} field={field} value={getPath(patch, field.key)} onChange={(next) => onChange(setPath(patch, field.key, next))} />
                : <div id={`ov-${field.key}`} className="truncate rounded-lg border border-[#d5d9e0] bg-[#fafbfc] px-2.5 py-[7px] font-mono text-[12.5px] text-ink-2">{value === undefined ? '未设置' : stringify(value, { lineWidth: 0 }).trimEnd().replace(/\n/g, ' · ')}</div>}
            </div>
            <div className="flex flex-[0_0_96px] justify-end">
              <button type="button" title={active ? '还原为预设值' : '点击覆盖这一项'} aria-label={`${active ? '还原' : '覆盖'} ${field.label}`}
                className={active ? 'h-7 cursor-pointer rounded-md bg-accent-soft px-2 text-[12px] text-accent-ink hover:underline' : 'h-7 cursor-pointer rounded-md px-2 text-[12px] text-muted hover:bg-ground hover:text-ink'} onClick={() => {
                const next = new Set(editing);
                if (active) next.delete(field.key); else next.add(field.key);
                setEditing(next);
                onChange(setPath(patch, field.key, active ? undefined : getPath(base, field.key)));
              }}>{active ? '覆盖 · 还原' : '来自预设'}</button>
            </div>
          </div>;
        })}
    </div></section>)}
    <ExtraFields value={otherFields(patch, groups)} onChange={(next) => onChange(replaceOtherFields(patch, next, groups))} />
  </div>;
}
