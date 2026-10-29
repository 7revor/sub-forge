// 独立的规则集客户端改写区块，只按规则内容定位。
import { Plus, Trash2 } from 'lucide-react';
import { formatRuleLine, type RuleSet } from '@sub-forge/core';
import { ClientOverrides, clientOverridesError, newClientOverride } from './ClientOverrides.tsx';
import { SortableList } from './SortableList.tsx';
import { Button, Card, Empty, ErrorBox, Field, Input } from './ui.tsx';

type ContentOverride = NonNullable<RuleSet['overrides']>[number];

export function overridesError(value: ContentOverride[]): string | undefined {
  for (const [i, item] of value.entries()) {
    if (!('append' in item.override.action) && !item.match?.trim()) return `改写第 ${i + 1} 条：请填写要匹配的规则内容。`;
    const error = clientOverridesError([item.override]);
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
  return <Card title="客户端改写" description="先选择改写方式与客户端条件。替换、丢弃按规则内容精确匹配，首条命中生效；追加无需匹配，直接加入新规则。可拖拽调整顺序，最终结果统一去重。mrs / srs 透传内容不参与匹配。" actions={<Button onClick={() => onChange([...value, { match: '', override: newClientOverride() }])}><Plus size={15} />添加改写</Button>}>
    {legacySources.filter((s) => s.overrides?.length).map((s) => <div key={s.id} className="mb-4 rounded-lg border border-line p-3 text-[12.5px]">
      <p className="mt-0">来源「{s.name || s.url || '本地规则'}」有 {s.overrides!.length} 条旧改写尚无法转换为内容匹配，仍按原配置生效。请启用来源、补充规则内容或拉取远程内容后保存，或添加组级改写后移除旧配置。</p>
      <ul className="pl-5">{s.overrides!.map((o, i) => <li key={i} className="break-all">{o.match ? `内容 ${o.match}` : `原第 ${o.line} 行`} · {o.override.when.client} / {o.override.when.platform || '不限平台'} · {'drop' in o.override.action ? '丢弃' : 'append' in o.override.action ? `追加 ${o.override.action.append.map(formatRuleLine).join('；')}` : `替换为 ${o.override.action.replace.map(formatRuleLine).join('；')}`}</li>)}</ul>
      <Button size="sm" onClick={() => onRemoveLegacy(s.id)}>移除该来源的旧改写</Button>
    </div>)}
    {!value.length ? <Empty title="没有客户端改写" description="添加后将统一应用于整个规则集。" /> : <SortableList items={value} onReorder={onChange} renderItem={(item, i, handle) => (
      <div className="my-3 flex items-start gap-2 rounded-lg border border-line p-3">
        {handle}<div className="flex min-w-0 flex-1 flex-col gap-3">
          <ClientOverrides single allowAppend value={[item.override]} onChange={(overrides) => {
            const override = overrides[0]!;
            update(i, 'append' in override.action ? { override } : { ...item, match: item.match ?? '', override });
          }} matchInput={!('append' in item.override.action) && <Field label="规则内容精确匹配" hint="填写来源中的完整规则内容，不含出口；相同内容在所有来源中都会匹配">{(id) => <Input id={id} className="font-mono" value={item.match ?? ''} onChange={(e) => update(i, { ...item, match: e.target.value })} />}</Field>} />
        </div>
        <Button size="sm" variant="ghost" aria-label={`删除客户端改写 ${i + 1}`} onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 size={14} /></Button>
      </div>
    )} />}
    <ErrorBox error={overridesError(value)} />
  </Card>;
}
