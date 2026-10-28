// 本地节点组：自建、中转等手写节点；表单或粘贴（URI / YAML / Surge）创建，可设置前置（LOC-01 / LOC-02）。

import { parseContent, type LocalProxy, type LocalProxyGroup, type Target } from '@sub-forge/core';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { DualEditor } from '../components/DualEditor.tsx';
import { SchemaForm } from '../components/SchemaForm.tsx';
import { defaultsFor, PROXY_TYPES, schemaFor } from '../schemas/proxy.ts';
import { groupFromYaml, groupToYaml, proxyFromYaml, proxyToYaml } from '../convert/proxyYaml.ts';
import { DetailShell } from '../components/DetailShell.tsx';
import { DocList } from '../components/DocList.tsx';
import { TargetPicker, useNodeSetNames } from '../components/pickers.tsx';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, Select, Switch, Textarea, cx } from '../components/ui.tsx';
import { useDocEditor } from '../components/useDocEditor.ts';

export function LocalList() {
  return (
    <DocList kind="locals" title="本地节点" intro="自建、中转等手写节点。每个分组就是一个节点集，可单独加入配置订阅。"
      columns={[
        { header: '分组', cell: (l) => l.name },
        { header: '节点', cell: (l) => <span className="font-mono">{l.proxies.length}</span> },
        { header: '设置了前置', cell: (l) => <span className="font-mono">{l.proxies.filter((p) => p.dialer).length}</span> },
      ]} />
  );
}

const EMPTY: LocalProxyGroup = { id: '', name: '', proxies: [] };
const CORE = new Set(['name', 'type', 'server', 'port', 'dialer']);

function PasteModal({ open, onClose, onImport }: { open: boolean; onClose: () => void; onImport: (p: LocalProxy[]) => void }) {
  const [text, setText] = useState('');
  const parsed = text.trim() ? parseContent(text, { type: 'local', id: 'paste' }) : undefined;
  const proxies: LocalProxy[] = (parsed?.proxies ?? []).map(({ _source, _origName, _key, upstreamDialer, ...rest }) => rest as LocalProxy);
  return (
    <Modal title="粘贴导入" open={open} onClose={onClose} wide
      footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={!proxies.length} onClick={() => { onImport(proxies); setText(''); onClose(); }}>导入 {proxies.length} 个节点</Button></>}>
      <Field label="URI 列表、Base64、Clash YAML 或 Surge [Proxy] 行" hint={parsed ? `识别为 ${parsed.format}，${proxies.length} 个节点${parsed.failures.length ? `，${parsed.failures.length} 个解析失败` : ''}` : undefined}>
        {(id) => <Textarea id={id} rows={8} className="font-mono" value={text} onChange={(e) => setText(e.target.value)} />}
      </Field>
      {parsed?.failures.length ? <ul className="m-0 pl-5 text-[12.5px] text-err">{parsed.failures.map((f, i) => <li key={i}>{f.line.slice(0, 60)} — {f.reason}</li>)}</ul> : null}
    </Modal>
  );
}

export function LocalEdit() {
  const e = useDocEditor('locals', EMPTY);
  const { all } = useNodeSetNames();
  const [sel, setSel] = useState(0);
  const [pasting, setPasting] = useState(false);
  const [groupText, setGroupText] = useState<string>();
  const [rawValid, setRawValid] = useState(true);
  const rawInvalid = !rawValid;
  if (!e.draft) return e.doc.error ? <ErrorBox error={e.doc.error} /> : <div className="text-muted">加载中…</div>;
  const d = e.draft;
  const setProxies = (proxies: LocalProxy[]) => e.setDraft({ ...d, proxies });
  const cur = d.proxies[sel];
  const update = (patch: Partial<LocalProxy>) => setProxies(d.proxies.map((p, i) => (i === sel ? { ...p, ...patch } : p)));
  const nodeSets = all.filter((n) => !(n.ref.type === 'local' && n.ref.id === d.id));
  const replace = (proxy: LocalProxy) => setProxies(d.proxies.map((p, i) => i === sel ? proxy : p));
  const groupResult = groupText === undefined ? undefined : groupFromYaml(groupText, d.proxies);
  const changeType = (type: string) => {
    if (!cur || type === cur.type) return;
    const removed = Object.keys(cur).filter((key) => !CORE.has(key));
    if (removed.length && !confirm(`切换协议将清除以下协议配置：${removed.join('、')}。是否继续？`)) return;
    replace({ ...defaultsFor(type), name: cur.name, server: cur.server, port: cur.port, ...(cur.dialer ? { dialer: cur.dialer } : {}) });
  };

  return (
    <DetailShell listPath="/locals" listLabel="本地节点组" isNew={e.isNew} name={d.name} dirty={e.dirty && !rawInvalid} saving={e.save.isPending}
      onSave={() => { if (!rawInvalid) e.submit(); }} saveError={e.save.error} onDelete={() => e.remove(d.name)} deleteError={e.del.error}>
      <Card title="分组"><Field label="名称">{(id) => <Input id={id} value={d.name} onChange={(x) => e.setDraft({ ...d, name: x.target.value })} />}</Field></Card>
      <div className="flex flex-wrap items-start gap-5">
        <Card title="节点" className="min-w-0 flex-[1_1_320px]" bodyClass="pb-3"
          actions={<><Button size="sm" disabled={rawInvalid} onClick={() => setGroupText(groupToYaml(d.proxies))}>分组 YAML</Button><Button size="sm" disabled={rawInvalid} onClick={() => setPasting(true)}>粘贴导入</Button>
            <Button size="sm" disabled={rawInvalid} onClick={() => { setProxies([...d.proxies, { ...defaultsFor('trojan'), name: `节点 ${d.proxies.length + 1}` }]); setSel(d.proxies.length); }}><Plus size={14} />新增</Button></>}>
          {!d.proxies.length ? <Empty>还没有节点。</Empty> : (
            <ul className="-mx-4 m-0 list-none p-0">
              {d.proxies.map((p, i) => (
                <li key={i}>
                  <button type="button" disabled={rawInvalid} onClick={() => setSel(i)} className={cx('flex w-full cursor-pointer items-center gap-2.5 border-t border-line-2 px-4 py-2.5 text-left', i === sel ? 'bg-accent-soft' : 'hover:bg-ground')}>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="text-[13.5px] font-medium">{p.name}</span><span className="truncate font-mono text-[12px] text-muted">{p.type} · {p.server}:{p.port}</span></span>
                    {p.dialer && <Badge tone="accent">前置</Badge>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {cur && (
          <Card title={`编辑 · ${cur.name}`} className="min-w-0 flex-[999_1_480px]" actions={<Button size="sm" variant="danger" disabled={rawInvalid} onClick={() => { setProxies(d.proxies.filter((_, i) => i !== sel)); setSel(Math.max(0, sel - 1)); }}><Trash2 size={14} />删除节点</Button>}>
            <div className="flex flex-col gap-4">
            <DualEditor key={sel} onValidityChange={setRawValid} value={cur} onChange={replace} toRaw={proxyToYaml} fromRaw={(text) => proxyFromYaml(text, cur)} rawLabel="节点 YAML" renderForm={() => <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="名称" className="col-span-2">{(id) => <Input id={id} value={cur.name} onChange={(x) => update({ name: x.target.value })} />}</Field>
                <Field label="协议">{(id) => <Select id={id} value={cur.type} onChange={(x) => changeType(x.target.value)}>
                  {!PROXY_TYPES.some((type) => type.value === cur.type) && <option value={cur.type}>{cur.type}</option>}
                  {PROXY_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                </Select>}</Field>
                <Field label="端口">{(id) => <Input id={id} type="number" value={cur.port} onChange={(x) => update({ port: Number(x.target.value) })} />}</Field>
                <Field label="服务器" className="col-span-2">{(id) => <Input id={id} className="font-mono" value={cur.server} onChange={(x) => update({ server: x.target.value })} />}</Field>
              </div>
              <SchemaForm groups={schemaFor(cur.type)} extra
                value={Object.fromEntries(Object.entries(cur).filter(([key]) => !CORE.has(key)))}
                onChange={(value) => replace({ ...Object.fromEntries(Object.entries(cur).filter(([key]) => CORE.has(key))), ...Object.fromEntries(Object.entries(value).filter(([key]) => !CORE.has(key))) } as LocalProxy)} />
            </div>} />
              <fieldset disabled={rawInvalid} className="m-0 flex min-w-0 flex-col gap-2.5 border-0 border-t border-solid border-line-2 p-0 pt-3.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13.5px] font-semibold">前置（dialer-proxy）</span>
                  <Switch label="设置前置" checked={!!cur.dialer} onChange={(on) => {
                    if (on) update({ dialer: { kind: 'node', ref: { nodeSet: nodeSets[0]?.ref ?? { type: 'source', id: '' }, match: { exact: '' }, fallback: { kind: 'builtin', name: 'REJECT' } } } });
                    else { const { dialer: _d, ...rest } = cur; setProxies(d.proxies.map((p, i) => (i === sel ? rest : p))); }
                  }} />
                </div>
                {cur.dialer && <TargetPicker label="前置" value={cur.dialer} groups={[]} allowGroup={false} nodeSets={nodeSets} onChange={(t: Target) => update({ dialer: t })} />}
                <span className="text-[12px] leading-relaxed text-muted">保存的是引用而不是节点快照：上游节点替换后按名称重新解析。前置所在的节点集需要同时加入使用它的配置订阅。前置为策略组时，请在配置订阅的「代理链」中设置。<Link to="/profiles" className="text-accent">前往配置订阅</Link></span>
              </fieldset>
            </div>
          </Card>
        )}
      </div>
      <Modal title="分组 YAML" open={groupText !== undefined} onClose={() => setGroupText(undefined)} wide
        footer={<><Button onClick={() => setGroupText(undefined)}>取消</Button><Button variant="primary" disabled={!groupResult?.ok} onClick={() => {
          if (groupResult?.ok) { setProxies(groupResult.value); setSel(0); setGroupText(undefined); }
        }}>应用到分组</Button></>}>
        <Field label="整个分组的 proxies 列表" hint="按节点名称保留已有前置；应用后请保存分组。">
          {(id) => <Textarea id={id} rows={18} className="font-mono" spellCheck={false} value={groupText ?? ''} onChange={(event) => setGroupText(event.target.value)} />}
        </Field>
        <ErrorBox error={groupResult && !groupResult.ok ? `第 ${groupResult.line ?? 1} 行：${groupResult.error}` : undefined} />
      </Modal>
      <PasteModal open={pasting} onClose={() => setPasting(false)} onImport={(ps) => setProxies([...d.proxies, ...ps])} />
    </DetailShell>
  );
}
