import type { GroupSpec } from '@sub-forge/core';
import { Field, Input, Select } from './ui.tsx';
import { groupPlaceholders } from '../schemas/placeholders.ts';

type Settings = Pick<GroupSpec, 'type' | 'test' | 'strategy'>;
const TYPES = ['select', 'url-test', 'fallback', 'load-balance'] as const;
const TEST_FIELDS = [
  ['url', '测速地址', false, groupPlaceholders.url],
  ['interval', '间隔（秒）', true, groupPlaceholders.interval], ['timeout', '超时（ms）', true, groupPlaceholders.timeout],
  ['maxFailedTimes', 'max-failed-times', true, groupPlaceholders.maxFailedTimes], ['expectedStatus', 'expected-status', false, groupPlaceholders.expectedStatus],
  ['tolerance', '容差（ms）', true, groupPlaceholders.tolerance],
  ['maxTimeout', 'Loon 可用性阈值（毫秒）', true, '填写 Loon 节点判定不可用的耗时阈值；其他端尚未等价适配'],
] as const;

/** 模板和配置订阅共用参数字段；覆盖写入及可编辑权限留给调用方。 */
export function GroupSettingsFields({ value, onChange, disabled = false, section = 'all' }: {
  value: Settings; disabled?: boolean; section?: 'all' | 'type' | 'advanced'; onChange: <K extends keyof Settings>(key: K, value: Settings[K] | undefined) => void;
}) {
  const test = value.test ?? {};
  return <>
    {section !== 'advanced' && <Field label="类型">{(id) => <Select disabled={disabled} placeholder={groupPlaceholders.type} id={id} value={value.type} onChange={(event) => onChange('type', event.target.value as GroupSpec['type'])}>
      {TYPES.map((type) => <option key={type} value={type}>{type.toUpperCase()}</option>)}
    </Select>}</Field>}
    {section !== 'type' && <>{value.type !== 'select' && <>
      {TEST_FIELDS.filter(([key]) => (key !== 'tolerance' || value.type === 'url-test') && (key !== 'maxTimeout' || ['fallback', 'load-balance'].includes(value.type))).map(([key, label, numeric, placeholder]) => <Field key={key} label={label}>{(id) => <Input disabled={disabled} id={id}
        type={numeric ? 'number' : 'text'} min={numeric ? 0 : undefined} step={key === 'maxFailedTimes' ? 1 : undefined}
        className={numeric ? undefined : 'font-mono'} placeholder={disabled ? `${placeholder}（模板未配置）` : placeholder} value={test[key] ?? ''}
        onChange={(event) => onChange('test', { ...test, [key]: event.target.value === '' ? undefined : numeric ? Number(event.target.value) : event.target.value })} />}</Field>)}
      <Field label="lazy">{(id) => <Select disabled={disabled} id={id} aria-label="lazy" placeholder={groupPlaceholders.lazy} clearable value={test.lazy === undefined ? '' : String(test.lazy)}
        onChange={(event) => onChange('test', { ...test, lazy: event.target.value === '' ? undefined : event.target.value === 'true' })}>
        <option value="true">开</option><option value="false">关</option>
      </Select>}</Field>
    </>}
    {value.type === 'load-balance' && <Field label="策略">{(id) => <Select disabled={disabled} id={id} aria-label="负载均衡策略" placeholder={groupPlaceholders.strategy} clearable value={value.strategy ?? ''} onChange={(event) => onChange('strategy', (event.target.value || undefined) as GroupSpec['strategy'])}>
      {['consistent-hashing', 'round-robin', 'sticky-sessions'].map((strategy) => <option key={strategy}>{strategy}</option>)}
    </Select>}</Field>}
    </>}
  </>;
}
