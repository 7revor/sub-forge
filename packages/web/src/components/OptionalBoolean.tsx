import { Segmented } from './ui.tsx';

export function OptionalBoolean({ label, value, onChange, size }: { label: string; value: boolean | undefined; onChange: (value: boolean | undefined) => void; size?: 'sm' | 'md' }) {
  return <Segmented label={label} size={size} value={value === undefined ? 'unset' : value ? 'on' : 'off'}
    options={[{ value: 'unset', label: '不设置' }, { value: 'on', label: '开' }, { value: 'off', label: '关' }]}
    onChange={(next) => onChange(next === 'unset' ? undefined : next === 'on')} />;
}
