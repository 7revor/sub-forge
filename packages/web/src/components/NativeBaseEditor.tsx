import { useId, useRef, useState } from 'react';
import { BASE_KERNELS, BASE_CLIENT_APPS, baseKernel, isIniClient, nativeBaseParents, type Client, type ClientApp, type NativeBase } from '@sub-forge/core';
import { stringify, parse } from 'yaml';
import { Badge, Button, FieldError, cx } from './ui.tsx';
import { YamlTextarea } from './YamlTextarea.tsx';
import './nativeBaseEditor.css';

type Target = { kernel: Client; app: ClientApp | undefined; label: string; title: string };
const GROUPS = BASE_KERNELS.map(scope => ({ label: scope.label, targets: [
  { kernel: scope.value, app: undefined, label: '公共配置', title: `${scope.label} 公共配置` },
  ...BASE_CLIENT_APPS.filter(app => baseKernel(app.kernel) === scope.value).map(app => ({ kernel: app.kernel, app: app.id, label: app.label, title: app.label })),
] as Target[] }));
const TARGETS = GROUPS.flatMap(group => group.targets);
const scopeLabel = (kernel: Client) => `${BASE_KERNELS.find(scope => scope.value === baseKernel(kernel))!.label} 公共配置`;
const lineCount = (text: string) => text.trimEnd().split('\n').length;
const INHERITED_MAX_ROWS = 8;

/** 左侧按内核分组选择目标；右侧把继承内容与当前原文叠成一份配置，切换时保留草稿。 */
export function NativeBaseEditor({ value, onChange }: { value: NativeBase; onChange: (value: NativeBase) => void }) {
  const id = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string>();
  const { kernel, app, title } = TARGETS[selected]!;
  const textOf = (target: Target) => (target.app ? value.clients?.[target.app] : value.kernels?.[baseKernel(target.kernel)]) ?? '';
  const inherited = nativeBaseParents(kernel, app).map(parent => ({ kernel: parent, label: scopeLabel(parent), text: value.kernels?.[parent] ?? '' })).filter(parent => parent.text.trim());
  const format = isIniClient(kernel) ? 'INI' : 'YAML';
  const scopeHint = !app ? '本内核客户端共用，客户端配置优先。' : !inherited.length ? '当前客户端专用。' : format === 'YAML' ? '合并字段，客户端优先；列表整体替换。' : 'General、Host、MITM 同名键覆盖，其他段落追加。';
  const text = textOf(TARGETS[selected]!);
  const select = (index: number) => { setSelected(index); setError(undefined); };
  const update = (text: string) => { setError(undefined); onChange(app ? { ...value, clients: { ...value.clients, [app]: text } } : { ...value, kernels: { ...value.kernels, [baseKernel(kernel)]: text } }); };
  return <div className="native-base-workspace">
    <div role="tablist" aria-label="配置目标" aria-orientation="vertical" className="native-base-targets">
      {GROUPS.map(group => <div key={group.label} role="presentation" className="native-base-group">
        <span aria-hidden="true" className="native-base-group-title">{group.label}</span>
        {group.targets.map(target => {
          const index = TARGETS.indexOf(target), filled = !!textOf(target).trim();
          return <button key={target.title} ref={node => { tabs.current[index] = node; }} type="button" role="tab" aria-label={filled ? `${target.title}，已填写 ${lineCount(textOf(target))} 行` : target.title}
            id={`${id}-${index}-tab`} aria-controls={`${id}-panel`} aria-selected={selected === index} tabIndex={selected === index ? 0 : -1}
            onClick={() => select(index)} onKeyDown={event => {
              if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? TARGETS.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + TARGETS.length) % TARGETS.length;
              select(next); tabs.current[next]?.focus();
            }} className={cx('native-base-target', target.app && 'native-base-child', selected === index && 'native-base-target-active')}>
            <span className="truncate">{target.label}</span>{filled && <span aria-hidden="true" className="native-base-count">{lineCount(textOf(target))} 行</span>}
          </button>;
        })}
      </div>)}
    </div>
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${selected}-tab`} className="native-base-content">
      <div className="native-base-frame">
        <div className="native-base-toolbar">
          <Badge>{format}</Badge>
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">{scopeHint}</p>
          <div className="flex shrink-0 gap-1">{format === 'YAML' && <Button size="sm" variant="ghost" disabled={!text.trim()} onClick={() => { try { update(stringify(parse(text))); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } }}>格式化</Button>}<Button size="sm" variant="ghost" disabled={!text} onClick={() => update('')}>清空</Button></div>
        </div>
        {inherited.map(parent => <section key={`${kernel}:${app ?? 'common'}:${parent.kernel}`} aria-label={`继承的 ${parent.label}原文`} className="native-base-layer native-base-layer-inherited">
          <h3 className="native-base-layer-title">继承自 {parent.label} · 只读</h3>
          <YamlTextarea readOnly aria-label={`继承的 ${parent.label}原文`} value={parent.text.trimEnd()} rows={Math.min(lineCount(parent.text), INHERITED_MAX_ROWS)} lineNumbers className="native-base-source native-base-source-readonly" placeholder={`${parent.label}没有内容`} />
        </section>)}
        <section aria-label="当前配置" className="native-base-layer native-base-layer-own">
          {inherited.length > 0 && <h3 className="native-base-layer-title">当前客户端追加</h3>}
          <YamlTextarea key={`${kernel}:${app ?? 'kernel'}`} aria-label={app ? `${title} 追加配置` : `${title}原文`} value={text} rows={15} lineNumbers
            className="native-base-source" placeholder={app ? `粘贴 ${title} 的原始 ${format} 配置` : `粘贴 ${title}的原始 ${format} 配置，本内核客户端共用`} onChange={event => update(event.target.value)} />
        </section>
        <div className="native-base-footer"><FieldError error={error} /><p>节点、策略组和规则由系统生成，请勿在此填写。</p></div>
      </div>
    </div>
  </div>;
}
