import { ChevronDown, ChevronRight } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { CLIENT_APPS, isIniClient, type Client, type ClientApp, type NativeBase } from '@sub-forge/core';
import { stringify, parse } from 'yaml';
import { Button, FieldError, cx } from './ui.tsx';
import { YamlTextarea } from './YamlTextarea.tsx';
import './nativeBaseEditor.css';

const KERNELS = [
  { value: 'mihomo', label: 'Mihomo' }, { value: 'surge', label: 'Surge' },
  { value: 'stash', label: 'Stash' }, { value: 'loon', label: 'Loon' },
] as const;
const TARGETS = KERNELS.flatMap(kernel => [
  { kernel: kernel.value, app: undefined as ClientApp | undefined, label: kernel.label },
  ...CLIENT_APPS.filter(app => app.kernel === kernel.value).map(app => ({ kernel: kernel.value, app: app.id as ClientApp | undefined, label: app.label })),
]);

/** 左侧选择内核或客户端，原文直接写回各自槽位，切换时保留草稿。 */
export function NativeBaseEditor({ value, onChange }: { value: NativeBase; onChange: (value: NativeBase) => void }) {
  const id = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [selected, setSelected] = useState(0);
  const [expanded, setExpanded] = useState<string[]>(['mihomo', 'surge']);
  const [error, setError] = useState<string>();
  const target = TARGETS[selected]!;
  const { kernel, app, label } = target;
  const format = isIniClient(kernel) ? 'INI' : 'YAML';
  const text = (app ? value.clients?.[app] : value.kernels?.[kernel]) ?? '';
  const update = (text: string) => { setError(undefined); onChange(app ? { ...value, clients: { ...value.clients, [app]: text } } : { ...value, kernels: { ...value.kernels, [kernel]: text } }); };
  return <div className="native-base-workspace">
    <div role="tablist" aria-label="配置目标" aria-orientation="vertical" className="native-base-targets">
      {TARGETS.map((scope, index) => (!scope.app || expanded.includes(scope.kernel)) && <div key={`${scope.kernel}:${scope.app ?? 'kernel'}`} className={cx('native-base-row', scope.app && 'native-base-row-child')} >{!scope.app && <button type="button" className="native-base-expand" aria-label={`${expanded.includes(scope.kernel) ? '收起' : '展开'} ${scope.label} 客户端`} aria-expanded={expanded.includes(scope.kernel)} onClick={() => { if (expanded.includes(scope.kernel) && target.kernel === scope.kernel && target.app) setSelected(index); setExpanded(current => current.includes(scope.kernel) ? current.filter(k => k !== scope.kernel) : [...current, scope.kernel]); }}>{expanded.includes(scope.kernel) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button>}<button key={`${scope.kernel}:${scope.app ?? 'kernel'}`} ref={node => { tabs.current[index] = node; }} type="button" role="tab"
        id={`${id}-${index}-tab`} aria-controls={`${id}-panel`} aria-selected={selected === index} tabIndex={selected === index ? 0 : -1}
        onClick={() => { setSelected(index); setError(undefined); }} onKeyDown={event => {
          if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const visible = TARGETS.flatMap((scope, i) => !scope.app || expanded.includes(scope.kernel) ? [i] : []);
          const next = event.key === 'Home' ? visible[0]! : event.key === 'End' ? visible.at(-1)! : visible[(visible.indexOf(index) + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length]!;
          setSelected(next); setError(undefined); tabs.current[next]?.focus();
        }} className={cx('native-base-target', scope.app && 'native-base-child', selected === index && 'native-base-target-active')}>
        <span>{scope.label}</span>{!!(scope.app ? value.clients?.[scope.app] : value.kernels?.[scope.kernel as Client])?.trim() && <span className="size-1.5 rounded-full bg-primary" aria-label="已配置" />}
      </button></div>)}
    </div>
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${selected}-tab`} className="native-base-content">
      <div className="native-base-toolbar"><div><h3 className="m-0 text-sm font-medium">{label}</h3><p className="m-0 text-xs text-muted-foreground">{app ? '仅用于此客户端，优先于内核公共配置' : `所有 ${label} 客户端共用，客户端专属内容优先`}</p></div>
        <div className="flex gap-2">{format === 'YAML' && <Button size="sm" variant="ghost" disabled={!text.trim()} onClick={() => { try { update(stringify(parse(text))); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } }}>格式化</Button>}<Button size="sm" variant="ghost" disabled={!text} onClick={() => update('')}>清空</Button></div>
      </div>
      <div className="native-base-editor-frame"><YamlTextarea key={`${kernel}:${app ?? 'kernel'}`} aria-label={app ? `${label} 追加配置` : `${label} 内核公共配置`} value={text} rows={15} lineNumbers
        className="native-base-source" placeholder={`粘贴 ${label} 的原始 ${format} 配置`} onChange={event => update(event.target.value)} />
      <FieldError error={error} />
      <div className="border-t border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground">{format} · proxies、proxy-groups、rules 由系统生成，这里写了也会被忽略</div></div>
    </div>
  </div>;
}
