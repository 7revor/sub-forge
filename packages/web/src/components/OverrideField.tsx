import { useState } from 'react';
import { stringify } from 'yaml';
import { ExtraFields } from './ExtraFields.tsx';
import { SchemaForm } from './SchemaForm.tsx';
import { isOverridden, overrideValue } from './override.ts';
import { getPath, otherFields, replaceOtherFields, setPath, type FieldGroup } from './schema.ts';
import { Button, Card } from './ui.tsx';

export function OverrideForm({ groups, base, patch, onChange }: {
  groups: FieldGroup[]; base: Record<string, unknown>; patch: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  // 预设没有值时，点击覆盖也要先展开输入，尚未输入则不向补丁写默认值。
  const [editing, setEditing] = useState<Set<string>>(() => new Set());
  return <div className="flex flex-col gap-4">
    <p className="m-0 text-[13px] text-muted">只保存覆盖项；与预设深度合并，列表整体替换。</p>
    {groups.map((group) => <Card key={group.title} title={group.title}>
      <div className="flex flex-col gap-4">
        {group.fields.map((field) => {
          const active = isOverridden(patch, field.key) || editing.has(field.key);
          const value = overrideValue(base, patch, field.key);
          return <div key={field.key} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px]">{field.label} · {active ? '覆盖值' : '继承值'}</span>
              <Button size="sm" aria-label={`${active ? '还原' : '覆盖'} ${field.label}`} onClick={() => {
                const next = new Set(editing);
                if (active) next.delete(field.key); else next.add(field.key);
                setEditing(next);
                onChange(setPath(patch, field.key, active ? undefined : getPath(base, field.key)));
              }}>{active ? '还原' : '覆盖'}</Button>
            </div>
            {field.type === 'lines' && <span className="text-[12px] text-muted">列表整体替换</span>}
            {active ? <SchemaForm groups={[{ title: field.label, fields: [field] }]} value={patch} onChange={onChange} />
              : <pre className="m-0 whitespace-pre-wrap break-all rounded bg-ground p-2 text-[12px] text-muted">{value === undefined ? '未设置' : stringify(value, { lineWidth: 0 }).trimEnd()}</pre>}
          </div>;
        })}
      </div>
    </Card>)}
    <ExtraFields value={otherFields(patch, groups)} onChange={(next) => onChange(replaceOtherFields(patch, next, groups))} />
  </div>;
}
