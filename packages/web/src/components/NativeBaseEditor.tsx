import { useId, useState } from 'react';
import { CLIENT_APPS, isIniClient, type Client, type ClientApp, type NativeBase } from '@sub-forge/core';
import { cx } from './ui.tsx';
import { YamlTextarea } from './YamlTextarea.tsx';

const KERNELS = [
  { id: 'mihomo', label: 'Mihomo' }, { id: 'surge', label: 'Surge' },
  { id: 'stash', label: 'Stash' }, { id: 'loon', label: 'Loon' },
] as const;
const filled = (text?: string) => !!text?.trim();

/** 导航只切换编辑视图，所有原文始终保留在订阅草稿中。 */
export function NativeBaseEditor({ value, onChange }: {
  value: NativeBase; onChange: (value: NativeBase) => void;
}) {
  const id = useId();
  const [kernel, setKernel] = useState<Client>('mihomo');
  const [selectedApps, setSelectedApps] = useState<Partial<Record<Client, ClientApp>>>({});
  const app = selectedApps[kernel];
  const format = isIniClient(kernel) ? 'INI' : 'YAML';
  const kernelLabel = KERNELS.find(k => k.id === kernel)!.label;
  const apps = CLIENT_APPS.filter(c => c.kernel === kernel);
  const appLabel = apps.find(c => c.id === app)?.label;
  const text = (app ? value.clients?.[app] : value.kernels?.[kernel]) ?? '';
  const label = appLabel ? `${appLabel} 追加` : '内核公共追加';
  const indicator = (hasText: boolean) => hasText && <><span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-brand" /><span className="sr-only">已填写</span></>;
  const targetButton = (target: ClientApp | undefined, title: string, hasText: boolean) => <button type="button" key={target ?? 'kernel'} aria-pressed={app === target}
    onClick={() => setSelectedApps(current => ({ ...current, [kernel]: target }))}
    className={cx('flex min-h-10 min-w-0 cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-[13px] transition-colors', app === target ? 'bg-panel font-semibold text-brand shadow-sm' : 'text-ink-2 hover:bg-panel/70')}>
    <span>{title}</span>{indicator(hasText)}
  </button>;
  return <div className="min-w-0">
    <div role="group" aria-label="配置内核" className="mx-4 mb-5 flex gap-1 border-b border-line sm:mx-5">
      {KERNELS.map(k => <button key={k.id} type="button" aria-pressed={kernel === k.id} onClick={() => setKernel(k.id)}
        className={cx('flex min-h-10 min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 border-b-2 px-2 text-[13px] transition-colors sm:flex-none sm:px-5', kernel === k.id ? 'border-brand font-semibold text-brand' : 'border-transparent text-ink-muted hover:text-ink')}>
        {k.label}{indicator(filled(value.kernels?.[k.id]) || CLIENT_APPS.some(c => c.kernel === k.id && filled(value.clients?.[c.id])))}
      </button>)}
    </div>
    <div className="grid min-w-0 gap-4 px-4 pb-5 sm:px-5 md:grid-cols-[184px_minmax(0,1fr)] md:gap-5">
      <div className="flex flex-col gap-4 self-start rounded-lg bg-ground p-2" role="group" aria-label={`${kernelLabel} 追加层级`}>
        {targetButton(undefined, '内核公共追加', filled(value.kernels?.[kernel]))}
        <div className="flex flex-col gap-2 pb-1">
          <p className="m-0 px-3 text-[12px] text-ink-muted">客户端追加 <span className="text-faint">可选</span></p>
          <div className="grid grid-cols-2 gap-1 md:grid-cols-1">
            {apps.map(c => targetButton(c.id, c.label, filled(value.clients?.[c.id])))}
          </div>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex min-h-10 min-w-0 items-center justify-between gap-3">
          <label htmlFor={`${id}-source`} className="min-w-0 text-[14px] font-semibold">{label}</label>
          <span className="text-[11px] font-medium text-ink-muted">{format}</span>
        </div>
        <YamlTextarea key={`${kernel}:${app ?? 'kernel'}`} id={`${id}-source`} value={text} rows={13}
          className="[&>textarea]:min-h-[280px]" placeholder={`粘贴 ${appLabel ?? kernelLabel} 的原始 ${format} 配置`}
          onChange={event => onChange(app ? { ...value, clients: { ...value.clients, [app]: event.target.value } } : { ...value, kernels: { ...value.kernels, [kernel]: event.target.value } })} />
      </div>
    </div>
  </div>;
}
