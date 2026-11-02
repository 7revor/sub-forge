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
  const inherited = nativeBaseParents(kernel, app).filter(parent => parent !== 'stash' || value.kernels?.stash?.trim()).map(parent => ({ kernel: parent, label: scopeLabel(parent), text: value.kernels?.[parent] ?? '' }));
  const visible = TARGETS.flatMap((scope, i) => scope.parents.every(parent => expanded.includes(parent)) ? [i] : []);
  const format = isIniClient(kernel) ? 'INI' : 'YAML';
  const text = (app ? value.clients?.[app] : value.kernels?.[kernel]) ?? '';
  const update = (text: string) => { setError(undefined); onChange(app ? { ...value, clients: { ...value.clients, [app]: text } } : { ...value, kernels: { ...value.kernels, [kernel]: text } }); };
  return <div className="native-base-workspace">
    <div role="tablist" aria-label="配置目标" aria-orientation="vertical" className="native-base-targets">
      {TARGETS.map((scope, index) => visible.includes(index) && <div key={`${scope.kernel}:${scope.app ?? 'kernel'}`} className={cx('native-base-row', scope.parents.length > 0 && 'native-base-row-child')} style={{ marginLeft: scope.parents.length * 14 }} >{!scope.app && <button type="button" className="native-base-expand" aria-label={`${expanded.includes(scope.kernel) ? '收起' : '展开'} ${scope.label} 客户端`} aria-expanded={expanded.includes(scope.kernel)} onClick={() => { if (expanded.includes(scope.kernel) && target.parents.includes(baseKernel(scope.kernel))) { setSelected(index); setError(undefined); } setExpanded(current => current.includes(scope.kernel) ? current.filter(k => k !== scope.kernel) : [...current, scope.kernel]); }}>{expanded.includes(scope.kernel) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button>}<button ref={node => { tabs.current[index] = node; }} type="button" role="tab"
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
      <div className="native-base-toolbar"><div><h3 className="m-0 text-sm font-medium">{label}</h3><p className="m-0 text-xs text-muted-foreground">{app ? '仅用于此客户端，优先于继承的公共配置' : `所有 ${label} 客户端共用${kernel === 'mihomo' ? '（含 Stash）' : ''}，客户端专属内容优先`}</p></div>
        <div className="flex gap-2">{format === 'YAML' && <Button size="sm" variant="ghost" disabled={!text.trim()} onClick={() => { try { update(stringify(parse(text))); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } }}>格式化</Button>}<Button size="sm" variant="ghost" disabled={!text} onClick={() => update('')}>清空</Button></div>
      </div>
      {inherited.length > 0 && <div className="mb-3 flex shrink-0 flex-col gap-2" aria-label="继承配置">
        {inherited.map(parent => <details key={`${kernel}:${app ?? 'common'}:${parent.kernel}`} className="min-w-0 rounded-lg border border-border bg-muted/40">
          <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">继承自 {parent.label} <span className="ml-1">· 只读</span></summary>
          {parent.text.trim() ? <CodePreview label={`继承的 ${parent.label}原文`} text={parent.text} lineNumbers className="mx-3 mb-3" bodyClassName="max-h-48" /> : <p className="m-0 px-3 pb-3 text-xs text-muted-foreground">{parent.label}{parent.kernel === 'stash' ? '为空' : '暂无公共配置'}</p>}
        </details>)}
        <p className="m-0 text-xs leading-relaxed text-muted-foreground">{format === 'YAML' ? 'YAML 映射递归合并；数组、标量和 null 由下层整体替换。例如 dns.nameserver 会替换整个列表，不会追加。' : 'INI 的 General、Host、MITM 中同名键由下层替换，其余段落按顺序追加。'}继承区仅展示当前草稿，不写入本层配置。</p>
      </div>}
      <div className="native-base-editor-frame"><YamlTextarea key={`${kernel}:${app ?? 'kernel'}`} aria-label={app ? `${label} 追加配置` : kernel === 'stash' ? 'Stash 公共追加配置' : `${label} 内核公共配置`} value={text} rows={15} lineNumbers
        className="native-base-source" placeholder={`粘贴 ${label} 的原始 ${format} 配置`} onChange={event => update(event.target.value)} />
      <FieldError error={error} />
      <div className="border-t border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground">{format} · proxies、proxy-groups、rules 由系统生成，这里写了也会被忽略</div></div>
    </div>
  </div>;
}
