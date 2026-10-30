import { useId, useRef, useState } from 'react';
import { FileCode2 } from 'lucide-react';
import { CLIENT_APPS, isIniClient, type Client, type ClientApp, type NativeBase } from '@sub-forge/core';
import { cx, Segmented } from './ui.tsx';
import { YamlTextarea } from './YamlTextarea.tsx';
import './nativeBaseEditor.css';

const KERNELS = [
  { value: 'mihomo', label: 'Mihomo' }, { value: 'surge', label: 'Surge' },
  { value: 'stash', label: 'Stash' }, { value: 'loon', label: 'Loon' },
] as const;

/** 文件页签仅切换原文槽位，不解析内容，也不改写其他内核或客户端。 */
export function NativeBaseEditor({ value, onChange }: {
  value: NativeBase; onChange: (value: NativeBase) => void;
}) {
  const id = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [kernel, setKernel] = useState<Client>('mihomo');
  const [selectedApps, setSelectedApps] = useState<Partial<Record<Client, ClientApp>>>({});
  const app = selectedApps[kernel];
  const format = isIniClient(kernel) ? 'INI' : 'YAML';
  const kernelLabel = KERNELS.find(k => k.value === kernel)!.label;
  const scopes: { app?: ClientApp; label: string }[] = [
    { label: '内核公共' }, ...CLIENT_APPS.filter(c => c.kernel === kernel).map(c => ({ app: c.id, label: c.label })),
  ];
  const selected = scopes.findIndex(scope => scope.app === app);
  const label = app ? `${scopes[selected]!.label} 追加配置` : `${kernelLabel} 内核公共配置`;
  const text = (app ? value.clients?.[app] : value.kernels?.[kernel]) ?? '';
  const selectScope = (index: number) => setSelectedApps(current => ({ ...current, [kernel]: scopes[index]!.app }));
  return <div className="flex min-w-0 flex-col gap-4">
    <Segmented label="配置内核" value={kernel} onChange={setKernel} options={[...KERNELS]} />
    <div className="native-base-workspace">
      <div className="native-base-toolbar">
        <div role="tablist" aria-label={`${kernelLabel} 追加配置`} className="flex min-w-0 overflow-x-auto">
          {scopes.map((scope, index) => <button key={scope.app ?? 'kernel'} ref={node => { tabs.current[index] = node; }}
            type="button" role="tab" id={`${id}-${index}-tab`} aria-controls={`${id}-panel`} aria-selected={selected === index} tabIndex={selected === index ? 0 : -1}
            onClick={() => selectScope(index)} onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? scopes.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + scopes.length) % scopes.length;
              selectScope(next); tabs.current[next]?.focus();
            }} className={cx('native-base-file', selected === index && 'native-base-file-active')}>
            <FileCode2 size={14} aria-hidden="true" className="hidden shrink-0 sm:block" />{scope.label}
          </button>)}
        </div>
        <span className="hidden shrink-0 px-4 text-[11px] text-ink-muted sm:block">{format}</span>
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${selected}-tab`}>
        <YamlTextarea key={`${kernel}:${app ?? 'kernel'}`} aria-label={label} value={text} rows={15} lineNumbers
          className="native-base-source" placeholder={`粘贴 ${app ? scopes[selected]!.label : kernelLabel} 的原始 ${format} 配置`}
          onChange={event => onChange(app ? { ...value, clients: { ...value.clients, [app]: event.target.value } } : { ...value, kernels: { ...value.kernels, [kernel]: event.target.value } })} />
      </div>
    </div>
  </div>;
}
