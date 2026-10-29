import type { GroupSpec } from '@sub-forge/core';
import { Field, Input, Select } from './ui.tsx';
import { OptionalBoolean } from './OptionalBoolean.tsx';

type Settings = Pick<GroupSpec, 'type' | 'test' | 'strategy'>;
const TYPES = ['select', 'url-test', 'fallback', 'load-balance'] as const;
const TEST_FIELDS = [
  ['url', '测速地址', false], ['interval', '间隔（秒）', true], ['timeout', '超时（ms）', true],
  ['maxFailedTimes', 'max-failed-times', true], ['expectedStatus', 'expected-status', false], ['tolerance', '容差（ms）', true],
] as const;

/** 模板和配置订阅共用参数字段；覆盖写入及可编辑权限留给调用方。 */
export function GroupSettingsFields({ value, onChange, defaultStrategy }: {
  value: Settings; onChange: <K extends keyof Settings>(key: K, value: Settings[K] | undefined) => void;
  defaultStrategy?: GroupSpec['strategy'];
}) {
  const test = value.test ?? {};
  return <>
    <Field label="类型">{(id) => <Select id={id} value={value.type} onChange={(event) => onChange('type', event.target.value as GroupSpec['type'])}>
      {TYPES.map((type) => <option key={type}>{type}</option>)}
    </Select>}</Field>
    {value.type !== 'select' && <>
      {TEST_FIELDS.filter(([key]) => key !== 'tolerance' || value.type === 'url-test').map(([key, label, numeric]) => <Field key={key} label={label}>{(id) => <Input id={id}
        type={numeric ? 'number' : 'text'} min={numeric ? 0 : undefined} step={key === 'maxFailedTimes' ? 1 : undefined}
        className={numeric ? undefined : 'font-mono'} value={test[key] ?? ''}
        onChange={(event) => onChange('test', { ...test, [key]: event.target.value === '' ? undefined : numeric ? Number(event.target.value) : event.target.value })} />}</Field>)}
      <div className="flex flex-col gap-1.5"><span className="text-[12.5px] font-medium text-muted">lazy</span><OptionalBoolean label="lazy" value={test.lazy} onChange={(lazy) => onChange('test', { ...test, lazy })} /></div>
    </>}
    {value.type === 'load-balance' && <Field label="策略">{(id) => <Select id={id} value={value.strategy ?? defaultStrategy ?? ''} onChange={(event) => onChange('strategy', (event.target.value || undefined) as GroupSpec['strategy'])}>
      {!defaultStrategy && <option value="">默认</option>}{['consistent-hashing', 'round-robin', 'sticky-sessions'].map((strategy) => <option key={strategy}>{strategy}</option>)}
    </Select>}</Field>}
  </>;
}
