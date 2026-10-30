import type { GroupSpec } from '@sub-forge/core';
import { Field, Input, Select } from './ui.tsx';

type Settings = Pick<GroupSpec, 'type' | 'test' | 'strategy'>;
const TYPES = ['select', 'url-test', 'fallback', 'load-balance'] as const;
const TEST_FIELDS = [
  ['url', '测速地址', false, '输入测速 URL（选填）'],
  ['interval', '间隔（秒）', true, '例如：300'], ['timeout', '超时（ms）', true, '例如：5000'],
  ['maxFailedTimes', 'max-failed-times', true, '例如：5'], ['expectedStatus', 'expected-status', false, '例如：204'],
  ['tolerance', '容差（ms）', true, '例如：50'],
] as const;

/** 模板和配置订阅共用参数字段；覆盖写入及可编辑权限留给调用方。 */
export function GroupSettingsFields({ value, onChange }: {
  value: Settings; onChange: <K extends keyof Settings>(key: K, value: Settings[K] | undefined) => void;
}) {
  const test = value.test ?? {};
  return <>
    <Field label="类型">{(id) => <Select id={id} value={value.type} onChange={(event) => onChange('type', event.target.value as GroupSpec['type'])}>
      {TYPES.map((type) => <option key={type} value={type}>{type.toUpperCase()}</option>)}
    </Select>}</Field>
    {value.type !== 'select' && <>
      {TEST_FIELDS.filter(([key]) => key !== 'tolerance' || value.type === 'url-test').map(([key, label, numeric, placeholder]) => <Field key={key} label={label}>{(id) => <Input id={id}
        type={numeric ? 'number' : 'text'} min={numeric ? 0 : undefined} step={key === 'maxFailedTimes' ? 1 : undefined}
        className={numeric ? undefined : 'font-mono'} placeholder={placeholder} value={test[key] ?? ''}
        onChange={(event) => onChange('test', { ...test, [key]: event.target.value === '' ? undefined : numeric ? Number(event.target.value) : event.target.value })} />}</Field>)}
      <Field label="lazy">{(id) => <Select id={id} placeholder="不设置" value={test.lazy === undefined ? '' : String(test.lazy)}
        onChange={(event) => onChange('test', { ...test, lazy: event.target.value === '' ? undefined : event.target.value === 'true' })}>
        {test.lazy !== undefined && <option value="">清空</option>}
        <option value="true">开</option><option value="false">关</option>
      </Select>}</Field>
    </>}
    {value.type === 'load-balance' && <Field label="策略">{(id) => <Select id={id} placeholder="默认策略" value={value.strategy ?? ''} onChange={(event) => onChange('strategy', (event.target.value || undefined) as GroupSpec['strategy'])}>
      {value.strategy && <option value="">清空</option>}{['consistent-hashing', 'round-robin', 'sticky-sessions'].map((strategy) => <option key={strategy}>{strategy}</option>)}
    </Select>}</Field>}
  </>;
}
