import { ChevronDown, ChevronRight } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { BASE_KERNELS, BASE_CLIENT_APPS, baseKernel, isIniClient, nativeBaseParents, type Client, type ClientApp, type NativeBase } from '@sub-forge/core';
import { stringify, parse } from 'yaml';
import { Button, FieldError, cx } from './ui.tsx';
import { YamlTextarea } from './YamlTextarea.tsx';
import { CodePreview } from './CodePreview.tsx';
import './nativeBaseEditor.css';

const TARGETS = BASE_KERNELS.flatMap<{ kernel: Client; app: ClientApp | undefined; label: string }>(scope => [
  { kernel: scope.value, app: undefined, label: scope.label },
  ...BASE_CLIENT_APPS.filter(app => baseKernel(app.kernel) === scope.value).map(app => ({ kernel: app.kernel, app: app.id, label: app.label })),
]).map(target => ({ ...target, parents: target.app ? [baseKernel(target.kernel)] : [] }));
const scopeLabel = (kernel: Client) => kernel === 'stash' ? '历史 Stash 公共配置' : `${BASE_KERNELS.find(scope => scope.value === kernel)!.label} 内核`;

/** 左侧选择内核或客户端，原文直接写回各自槽位，切换时保留草稿。 */
export function NativeBaseEditor({ value, onChange }: { value: NativeBase; onChange: (value: NativeBase) => void }) {
  const id = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [selected, setSelected] = useState(0);
  const [expanded, setExpanded] = useState<string[]>(['mihomo', 'surge']);
  const [error, setError] = useState<string>();
  const target = TARGETS[selected]!;
  const { kernel, app, label } = target;
  const inherited = nativeBaseParents(kernel, app).map(parent => ({ kernel: parent, label: scopeLabel(parent), text: value.kernels?.[parent] ?? '' })).filter(parent => parent.text.trim());
  const visible = TARGETS.flatMap((scope, i) => scope.parents.every(parent => expanded.includes(parent)) ? [i] : []);
  const format = isIniClient(kernel) ? 'INI' : 'YAML';
  const text = (app ? value.clients?.[app] : value.kernels?.[kernel]) ?? '';
  const update = (text: string) => { setError(undefined); onChange(app ? { ...value, clients: { ...value.clients, [app]: text } } : { ...value, kernels: { ...value.kernels, [kernel]: text } }); };
  return <div className="native-base-workspace">
    <div role="tablist" aria-label="配置目标" aria-orientation="vertical" className="native-base-targets">
      {TARGETS.map((scope, index) => visible.includes(index) && <div key={`${scope.kernel}:${scope.app ?? 'kernel'}`} className={cx('native-base-row', scope.parents.length > 0 && 'native-base-row-child')} >{!scope.app && <button type="button" className="native-base-expand" aria-label={`${expanded.includes(scope.kernel) ? '收起' : '展开'} ${scope.label} 客户端`} aria-expanded={expanded.includes(scope.kernel)} onClick={() => { if (expanded.includes(scope.kernel) && target.parents.includes(baseKernel(scope.kernel))) { setSelected(index); setError(undefined); } setExpanded(current => current.includes(scope.kernel) ? current.filter(k => k !== scope.kernel) : [...current, scope.kernel]); }}>{expanded.includes(scope.kernel) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button>}<button ref={node => { tabs.current[index] = node; }} type="button" role="tab"
        id={`${id}-${index}-tab`} aria-controls={`${id}-panel`} aria-selected={selected === index} tabIndex={selected === index ? 0 : -1}
        onClick={() => { setSelected(index); setError(undefined); }} onKeyDown={event => {
          if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? visible[0]! : event.key === 'End' ? visible.at(-1)! : visible[(visible.indexOf(index) + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length]!;
          setSelected(next); setError(undefined); tabs.current[next]?.focus();
        }} className={cx('native-base-target', scope.parents.length > 0 && 'native-base-child', selected === index && 'native-base-target-active')}>
        <span>{scope.label}</span>{!!(scope.app ? value.clients?.[scope.app] : value.kernels?.[scope.kernel as Client])?.trim() && <span className="size-1.5 rounded-full bg-primary" aria-label="已配置" />}
      </button></div>)}
    </div>
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${selected}-tab`} className="native-base-content">
      {inherited.length > 0 && <div className="mb-3 flex shrink-0 flex-col gap-2" aria-label="继承配置">
        {inherited.map(parent => <CodePreview key={`${kernel}:${app ?? 'common'}:${parent.kernel}`} label={`继承的 ${parent.label}原文`} text={parent.text} lineNumbers bodyClassName="max-h-48"
          footer={`继承自 ${parent.label} · 只读`} />)}
      </div>}
      <div className="native-base-editor-frame"><YamlTextarea key={`${kernel}:${app ?? 'kernel'}`} aria-label={app ? `${label} 追加配置` : kernel === 'stash' ? 'Stash 公共追加配置' : `${label} 内核公共配置`} value={text} rows={15} lineNumbers
        className="native-base-source" placeholder={`粘贴 ${label} 的原始 ${format} 配置`} onChange={event => update(event.target.value)} />
      <FieldError error={error} />
      <div className="native-base-editor-footer">
        <span className="text-xs text-muted-foreground">{format}</span>
        <div className="flex gap-1">{format === 'YAML' && <Button size="sm" variant="ghost" disabled={!text.trim()} onClick={() => { try { update(stringify(parse(text))); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } }}>格式化</Button>}<Button size="sm" variant="ghost" disabled={!text} onClick={() => update('')}>清空</Button></div>
      </div></div>
    </div>
  </div>;
}
