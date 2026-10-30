import { useId, useState } from 'react';
import { CLIENT_APPS, isIniClient, type Client, type ClientApp, type NativeBase } from '@sub-forge/core';
import { Field, Segmented, Select } from './ui.tsx';
import { YamlTextarea } from './YamlTextarea.tsx';
import { CodePreview } from './CodePreview.tsx';

/** 文本直接写入草稿；切换目标不解析、不转换、不重建任何文本。 */
export function NativeBaseEditor({ value, onChange, inherited, preset = false }: {
  value: NativeBase; onChange: (value: NativeBase) => void; inherited?: NativeBase; preset?: boolean;
}) {
  const id = useId();
  const [kernel, setKernel] = useState<Client>('mihomo');
  const [app, setApp] = useState<ClientApp>();
  const format = isIniClient(kernel) ? 'INI' : 'YAML';
  const apps = CLIENT_APPS.filter(c => c.kernel === kernel);
  const editor = (layer: 'kernels' | 'clients', target: Client | ClientApp, label: string) => {
    const text = (value[layer] as Record<string, string> | undefined)?.[target] ?? '';
    const previous = (inherited?.[layer] as Record<string, string> | undefined)?.[target];
    return <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={`${id}-${layer}`} className="text-[13px] font-medium">{label} · {format}</label>
      {previous && <details className="text-[12px] text-ink-muted"><summary className="cursor-pointer">查看预设原文</summary><CodePreview label="预设原文" text={previous} bodyClassName="max-h-64" /></details>}
      <YamlTextarea id={`${id}-${layer}`} value={text} rows={14} placeholder={`粘贴 ${label}的原始 ${format} 配置，留空表示不追加`}
        onChange={event => onChange({ ...value, [layer]: { ...value[layer], [target]: event.target.value } })} />
    </div>;
  };
  return <div className="flex min-w-0 flex-col gap-4">
    <Segmented label="配置内核" value={kernel} options={[{ value: 'mihomo', label: 'Mihomo' }, { value: 'surge', label: 'Surge' }, { value: 'stash', label: 'Stash' }, { value: 'loon', label: 'Loon' }]}
      onChange={value => { setKernel(value); setApp(undefined); }} />
    <p className="m-0 text-[12.5px] text-ink-muted">按内核匹配公共追加，再匹配客户端追加。原文直接保存，生成时检查格式；不同内核之间不转换。</p>
    {editor('kernels', kernel, '内核公共追加')}
    <Field label="客户端追加（可选）">{fieldId => <Select clearable id={fieldId} placeholder="选择需要单独追加配置的客户端" value={app ?? ''} onChange={e => setApp(e.target.value ? e.target.value as ClientApp : undefined)}>
      {apps.map(c => <option key={c.id} value={c.id}>{c.label}{value.clients?.[c.id] ? ' · 已填写' : ''}</option>)}
    </Select>}</Field>
    {app && editor('clients', app, CLIENT_APPS.find(c => c.id === app)!.label + ' 追加')}
    <p className="m-0 text-[12px] text-ink-muted">同层先预设后订阅；YAML 映射逐键合并，数组和标量由后层替换。INI 的 General、Host、MITM 同名键由后层替换，其余段落追加。节点、策略组和规则由订阅生成。{preset ? 'listeners 请放在订阅追加中。' : 'listeners 可在此填写。'}</p>
  </div>;
}
