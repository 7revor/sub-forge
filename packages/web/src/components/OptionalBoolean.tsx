import { Select } from './ui.tsx';

export function OptionalBoolean({ label, placeholder, value, onChange, size }: { label: string; placeholder: string; value: boolean | undefined; onChange: (value: boolean | undefined) => void; size?: 'sm' | 'md' }) {
  return <Select aria-label={label} placeholder={placeholder} clearable className={size === 'sm' ? 'h-9' : undefined}
    value={value === undefined ? '' : String(value)} onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value === 'true')}>
    <option value="true">开启</option><option value="false">关闭</option>
  </Select>;
}
