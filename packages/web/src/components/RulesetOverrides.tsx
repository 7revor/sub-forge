// 独立的规则集客户端改写区块，只按规则内容定位。
import { Plus, Trash2 } from 'lucide-react';
import { formatRuleLine, type RuleSet } from '@sub-forge/core';
import { ClientOverrides, clientOverridesError, newClientOverride } from './ClientOverrides.tsx';
import { SortableList } from './SortableList.tsx';
import { Button, Card, Empty, Field, Input } from './ui.tsx';

type ContentOverride = NonNullable<RuleSet['overrides']>[number];

function contentOverrideError(item: ContentOverride): string | undefined {
  if (!('append' in item.override.action) && !item.match?.trim()) return '请填写要匹配的规则内容。';
  const action = item.override.action;
  if ('drop' in action) return undefined;
  return clientOverridesError([item.override]) ? `请填写至少一条完整的${'append' in action ? '追加' : '替换'}规则。` : undefined;
}

export function overridesError(value: ContentOverride[]): string | undefined {
  for (const [i, item] of value.entries()) {
    const error = contentOverrideError(item);
    if (error) return `改写第 ${i + 1} 条：${error}`;
  }
  return undefined;
}

export function RulesetOverrides({ value, legacySources, onChange, onRemoveLegacy }: {
  value: ContentOverride[];
  legacySources: RuleSet['sources'];
  onChange: (value: ContentOverride[]) => void;
  onRemoveLegacy: (id: string) => void;
}) {
  const update = (index: number, item: ContentOverride) => onChange(value.map((entry, i) => i === index ? item : entry));
  return <Card title="客户端改写" bodyClass={value.length ? 'px-4 pb-1' : undefined} actions={<Button onClick={() => onChange([...value, { match: '', override: newClientOverride() }])}><Plus size={15} />添加改写</Button>}>
    {legacySources.filter((s) => s.overrides?.length).map((s) => <div key={s.id} className="mb-4 rounded-lg border border-line p-3 text-[12.5px]">
      <p className="mt-0">来源「{s.name || s.url || '本地规则'}」有 {s.overrides!.length} 条旧改写尚无法转换为内容匹配，仍按原配置生效。请补充规则内容或拉取远程内容后保存，或添加组级改写后移除旧配置。</p>
      <ul className="pl-5">{s.overrides!.map((o, i) => <li key={i} className="break-all">{o.match ? `内容 ${o.match}` : `原第 ${o.line} 行`} · {o.override.when.client} / {o.override.when.platform || '不限平台'} · {'drop' in o.override.action ? '丢弃' : 'append' in o.override.action ? `追加 ${o.override.action.append.map(formatRuleLine).join('；')}` : `替换为 ${o.override.action.replace.map(formatRuleLine).join('；')}`}</li>)}</ul>
      <Button size="sm" onClick={() => onRemoveLegacy(s.id)}>移除该来源的旧改写</Button>
    </div>)}
    {!value.length ? <Empty title="没有客户端改写" /> : <SortableList items={value} onReorder={onChange} renderItem={(item, i, handle) => (
      <div role="group" aria-label={`客户端改写 ${i + 1}`} className="min-w-0 border-t border-line-2 py-3">
        <ClientOverrides single allowAppend value={[item.override]} leading={handle}
          trailing={<Button size="sm" variant="ghost" aria-label={`删除客户端改写 ${i + 1}`} onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 size={14} /></Button>}
          onChange={(overrides) => {
            const override = overrides[0]!;
            update(i, 'append' in override.action ? { override } : { ...item, match: item.match ?? '', override });
          }} matchInput={!('append' in item.override.action) && <Field label="规则内容精确匹配">{(id) => <Input id={id} className="font-mono" placeholder="完整规则，不含出口，如 DOMAIN,example.com" value={item.match ?? ''} onChange={(e) => update(i, { ...item, match: e.target.value })} />}</Field>} />
        {contentOverrideError(item) && <p role="alert" className="m-0 mt-3 text-[12px] text-err">{contentOverrideError(item)}</p>}
      </div>
    )} />}
  </Card>;
}
