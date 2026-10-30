import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { ExtraFields } from './ExtraFields.tsx';
import { getPath, isRecord, otherFields, replaceOtherFields, setPath, type FieldGroup, type FieldSpec } from './schema.ts';
import { Button, Field, Input, Select, Textarea } from './ui.tsx';

export function FieldInput({ field, value, id, onChange }: {
  field: FieldSpec; value: unknown; id: string; onChange: (value: unknown) => void;
}) {
  if (field.type === 'bool' || field.type === 'enum') {
    return <Select id={id} aria-label={field.label} placeholder={field.placeholder} clearable value={value == null ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? undefined : field.type === 'bool' ? e.target.value === 'true' : e.target.value)}>
      {field.type === 'bool' ? <><option value="true">开启</option><option value="false">关闭</option></> : <>
        {value != null && !(field.options ?? []).includes(String(value)) && <option value={String(value)}>{String(value)}</option>}
        {(field.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
      </>}
    </Select>;
  }
  if (field.type === 'lines') {
    return <Textarea id={id} rows={4} placeholder={field.placeholder} value={Array.isArray(value) ? value.join('\n') : ''}
      onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value.split('\n'))} />;
  }
  if (field.type === 'kv') {
    const pairs = isRecord(value) ? value : {};
    return <div id={id} className="flex flex-col gap-2">
      {Object.entries(pairs).map(([key, item], index) => <div key={index} className="flex gap-2">
        <Input aria-label={`${field.label} 第 ${index + 1} 项键`} placeholder={field.keyPlaceholder ?? `${field.placeholder}：参数名称`} value={key} onChange={(e) => {
          if (e.target.value !== key && Object.hasOwn(pairs, e.target.value)) return;
          onChange(Object.fromEntries(Object.entries(pairs).map(([k, v]) => [k === key ? e.target.value : k, v])));
        }} />
        <Input aria-label={`${field.label} 第 ${index + 1} 项值`} placeholder={field.valuePlaceholder ?? `${field.placeholder}：参数值`} value={String(item ?? '')} onChange={(e) => onChange({ ...pairs, [key]: e.target.value })} />
        <Button size="sm" onClick={() => {
          const next = Object.fromEntries(Object.entries(pairs).filter(([k]) => k !== key));
          onChange(Object.keys(next).length ? next : undefined);
        }}>删除</Button>
      </div>)}
      <Button size="sm" disabled={Object.hasOwn(pairs, '')} onClick={() => onChange({ ...pairs, '': '' })}>添加键值</Button>
    </div>;
  }
  return <Input id={id} type={field.type === 'number' ? 'number' : 'text'} step={field.type === 'number' ? 'any' : undefined}
    placeholder={field.placeholder} value={value == null ? '' : String(value)} onChange={(e) => {
      const text = e.target.value;
      if (text === '') onChange(undefined);
      else if (field.type !== 'number') onChange(text);
      else if (Number.isFinite(e.target.valueAsNumber)) onChange(e.target.valueAsNumber);
    }} />;
}

/** 表单内的分区：嵌在卡片里使用，以分隔线区分，不再套一层卡片 */
export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return <section data-section={title} className="flex scroll-mt-4 flex-col gap-3 border-t border-line-2 pt-3.5">
    <h3 className="m-0 text-[13.5px] font-semibold">{title}</h3>
    {children}
  </section>;
}

export function SchemaField({ field, value, onChange }: { field: FieldSpec; value: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void }) {
  return <Field label={field.label} hint={[field.hint, field.clients?.join(' / ')].filter(Boolean).join(' · ')}>
    {(id) => <FieldInput id={id} field={field} value={getPath(value, field.key)} onChange={(next) => onChange(setPath(value, field.key, next))} />}
  </Field>;
}

export function SchemaForm({ groups, value, onChange, extra = false, collapsible = false }: {
  groups: FieldGroup[]; value: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void; extra?: boolean;
  /** 按配置分组默认收起，各组可独立展开；折叠不卸载字段，保留输入状态。 */
  collapsible?: boolean;
}) {
  return <div className="flex flex-col gap-4">
    {groups.map((group) => {
      const fields = group.fields.filter((field) => !field.showIf || field.showIf(value));
      const inputs = fields.map((field) => <SchemaField key={field.key} field={field} value={value} onChange={onChange} />);
      return collapsible ? <details key={group.title} data-section={group.title} className="group border-t border-line-2 pt-3.5">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-sm text-[13.5px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand [&::-webkit-details-marker]:hidden">
          <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-ink-muted transition-transform group-open:rotate-90" />
          <span>{group.title}</span>
          <span className="ml-auto text-[12px] font-normal text-ink-muted">{fields.length} 项配置</span>
        </summary>
        <div className="flex flex-col gap-3 pt-4">{inputs}</div>
      </details> : <FormSection key={group.title} title={group.title}>{inputs}</FormSection>;
    })}
    {extra && <ExtraFields value={otherFields(value, groups)} onChange={(next) => onChange(replaceOtherFields(value, next, groups))} />}
  </div>;
}
