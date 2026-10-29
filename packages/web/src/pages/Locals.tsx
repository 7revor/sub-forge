// 本地节点（设计稿「本地节点」）：一页完成——分组标签、所选分组的节点表、右侧编辑节点（表单 / YAML）与前置（LOC-01 / LOC-02）。
// 每个分组是一个节点集文档；切换分组前有未保存的修改时先确认。

import { parseContent, type LocalProxy, type LocalProxyGroup, type Target } from '@sub-forge/core';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { DualEditor } from '../components/DualEditor.tsx';
import { SchemaForm } from '../components/SchemaForm.tsx';
import { defaultsFor, PROXY_TYPES, schemaFor } from '../schemas/proxy.ts';
import { groupFromYaml, groupToYaml, proxyDraftFromYaml, proxyFormFromYaml, proxyToYaml } from '../convert/proxyYaml.ts';
import { DeleteMenu } from '../components/MoreMenu.tsx';
import { RenameDialog } from '../components/dialogs.tsx';
import { TargetPicker, useNodeSetNames } from '../components/pickers.tsx';
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Select, Switch, Textarea, cx, td, th } from '../components/ui.tsx';
import { useDocEditor } from '../components/useDocEditor.ts';
import { useList, useSaveDoc } from '../hooks.ts';

const INTRO = '自建、中转等手写节点。每个分组就是一个节点集，可单独加入配置订阅。';
const EMPTY: LocalProxyGroup = { id: '', name: '', proxies: [] };
const CORE = new Set(['name', 'type', 'server', 'port', 'dialer']);

function NewGroupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const save = useSaveDoc('locals');
  const [name, setName] = useState('');
  useEffect(() => { if (open) setName(''); }, [open]);
  const create = () => save.mutate({ name: name.trim(), proxies: [] }, { onSuccess: (item) => { onClose(); navigate(`/locals/${item.id}`); } });
  return (
    <Modal title="新建分组" open={open} onClose={onClose}
      footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={!name.trim() || save.isPending} onClick={create}>{save.isPending ? '创建中…' : '创建'}</Button></>}>
      <label className="flex flex-col gap-1.5"><span className="text-[12.5px] font-medium text-muted">分组名称</span>
        <Input autoFocus placeholder="例如：自建、家宽" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) create(); }} /></label>
      <ErrorBox error={save.error} />
    </Modal>
  );
}

/** /locals：有分组时跳到第一个分组，否则显示空状态 */
export function LocalList() {
  const list = useList('locals');
  const [creating, setCreating] = useState(false);
  if (list.isLoading) return <div className="text-muted">加载中…</div>;
  if (list.data?.length) return <Navigate to={`/locals/${list.data[0]!.id}`} replace />;
  return (
    <>
      <PageHeader title="本地节点" subtitle={INTRO} actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus size={16} />新建分组</Button>} />
      <ErrorBox error={list.error} />
      <section className="flex flex-col items-center gap-2 rounded-[10px] border border-dashed border-[#d5d9e0] bg-panel px-7 py-7 text-center">
        <span className="text-[14px] font-semibold">还没有本地节点组</span>
        <span className="max-w-[420px] text-[12.5px] leading-relaxed text-muted">自建、中转等手写节点按分组管理，每个分组都能单独加入配置订阅。</span>
        <Button size="sm" onClick={() => setCreating(true)}>新建分组</Button>
      </section>
      <NewGroupModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function PasteModal({ open, onClose, onImport }: { open: boolean; onClose: () => void; onImport: (p: LocalProxy[]) => void }) {
  const [text, setText] = useState('');
  const parsed = text.trim() ? parseContent(text, { type: 'local', id: 'paste' }) : undefined;
  const proxies: LocalProxy[] = (parsed?.proxies ?? []).map(({ _source, _origName, _key, upstreamDialer, ...rest }) => rest as LocalProxy);
  return (
    <Modal title="粘贴导入节点" open={open} onClose={onClose} wide
      footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={!proxies.length} onClick={() => { onImport(proxies); setText(''); onClose(); }}>导入 {proxies.length} 个节点</Button></>}>
      <Field label="URI 列表、Base64、Clash YAML 或 Surge [Proxy] 行">
        {(id) => <Textarea id={id} rows={8} className="font-mono text-[12.5px]" value={text} onChange={(e) => setText(e.target.value)} />}
      </Field>
      {parsed && <div className="flex flex-wrap gap-2">
        <Badge tone={proxies.length ? 'ok' : 'neutral'}>识别为 {parsed.format} · {proxies.length} 个节点</Badge>
        {parsed.failures.length > 0 && <Badge tone="err">{parsed.failures.length} 行无法解析</Badge>}
      </div>}
      {parsed?.failures.length ? <ul className="m-0 pl-5 font-mono text-[12px] text-err">{parsed.failures.map((f, i) => <li key={i}>{f.line.slice(0, 60)} — {f.reason}</li>)}</ul> : null}
    </Modal>
  );
}

function dialerText(p: LocalProxy, nameOf: (r: NonNullable<Extract<Target, { kind: 'node' }>['ref']>['nodeSet']) => string): string {
  const d = p.dialer;
  if (!d) return '—';
  if (d.kind === 'node') return `${nameOf(d.ref.nodeSet)} · ${'exact' in d.ref.match ? d.ref.match.exact : d.ref.match.regex}`;
  if (d.kind === 'builtin') return d.name;
  return '策略组';
}

export function LocalEdit() {
  const navigate = useNavigate();
  const e = useDocEditor('locals', EMPTY);
  const groups = useList('locals');
  const { all, nameOf } = useNodeSetNames();
  const [sel, setSel] = useState(0);
  const [pasting, setPasting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [groupText, setGroupText] = useState<string>();
  const [leaveTo, setLeaveTo] = useState<string>();
  const [rawValid, setRawValid] = useState(true);
  const rawInvalid = !rawValid;
  useEffect(() => setSel(0), [e.id]);
  if (e.isNew) return <Navigate to="/locals" replace />;
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
  const go = (to: string) => { if (e.dirty) setLeaveTo(to); else navigate(to); };
  const addNode = () => { setProxies([...d.proxies, { ...defaultsFor('trojan'), name: `节点 ${d.proxies.length + 1}` }]); setSel(d.proxies.length); };

  return (
    <>
      <PageHeader title="本地节点" subtitle={INTRO}
        actions={<>
          <Button onClick={() => setCreating(true)}>新建分组</Button>
          <DeleteMenu what="分组" name={d.name} body="分组里的节点会一起删除；引用它的配置订阅需要先移除。" error={e.del.error} pending={e.del.isPending} onReset={e.del.reset} onDelete={e.remove}
            extra={[{ label: '重命名分组…', onSelect: () => setRenaming(true) }, { label: '分组 YAML…', onSelect: () => { if (!rawInvalid) setGroupText(groupToYaml(d.proxies)); } }]} />
          <Button variant="primary" onClick={() => { if (!rawInvalid) e.submit(); }} disabled={e.save.isPending || rawInvalid || !e.dirty}>{e.save.isPending ? '保存中…' : e.dirty ? '保存分组' : '已保存'}</Button>
        </>} />
      <ErrorBox error={e.save.error} />

      <div role="tablist" aria-label="分组" className="flex flex-wrap gap-2">
        {(groups.data ?? []).map((g) => {
          const on = g.id === d.id;
          const count = on ? d.proxies.length : g.proxies.length;
          return <button key={g.id} type="button" role="tab" aria-selected={on} onClick={() => { if (!on) go(`/locals/${g.id}`); }}
            className={cx('h-9 cursor-pointer rounded-full border px-3.5 text-[13px]', on ? 'border-accent bg-[#f5f8ff] font-medium text-accent-ink' : 'border-[#d5d9e0] bg-panel text-ink-2 hover:bg-ground')}>
            {on ? d.name : g.name} · {count}{on && e.dirty && ' ·未保存'}
          </button>;
        })}
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <Card className="min-w-0 flex-[999_1_560px]" bodyClass="overflow-x-auto"
          title={<h2 className="m-0 text-[15px] font-semibold">节点</h2>}
          actions={<><Button size="sm" disabled={rawInvalid} onClick={() => setPasting(true)}>粘贴导入</Button><Button size="sm" disabled={rawInvalid} onClick={addNode}><Plus size={14} />新增节点</Button></>}>
          {!d.proxies.length ? <div className="px-4 pb-4 text-[13px] text-muted">这个分组还没有节点。新增一个，或粘贴 URI / YAML 一次导入多个。</div> : (
            <table className="w-full min-w-[620px] border-collapse">
              <thead><tr><th className={th}>名称</th><th className={th}>协议</th><th className={th}>服务器</th><th className={th}>前置</th><th className={cx(th, 'w-px')}><span className="sr-only">操作</span></th></tr></thead>
              <tbody>
                {d.proxies.map((p, i) => (
                  <tr key={i} className={i === sel ? 'bg-[#f5f8ff]' : undefined}>
                    <td className={cx(td, 'font-medium whitespace-nowrap')}>{p.name}</td>
                    <td className={td}><span className="rounded bg-[#ebedf1] px-1.5 py-0.5 font-mono text-[12px]">{p.type}</span></td>
                    <td className={cx(td, 'font-mono text-[12.5px] text-ink-2')}>{p.server}:{p.port}</td>
                    <td className={cx(td, 'text-[12.5px]')}>{dialerText(p, nameOf)}</td>
                    <td className={td}><Button size="sm" disabled={rawInvalid} aria-label={`编辑 ${p.name}`} onClick={() => setSel(i)}>编辑</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {cur && (
          <Card title={`编辑 · ${cur.name}`} className="min-w-0 flex-[1_1_380px]"
            actions={<Button size="sm" variant="ghost" className="text-err" disabled={rawInvalid} onClick={() => { setProxies(d.proxies.filter((_, i) => i !== sel)); setSel(Math.max(0, sel - 1)); }}><Trash2 size={14} />删除节点</Button>}>
            <div className="flex flex-col gap-4">
              <DualEditor key={`${d.id}-${sel}`} onValidityChange={setRawValid} value={cur} onChange={replace} toRaw={proxyToYaml} fromRaw={(text) => proxyDraftFromYaml(text, cur)} recoverForm={(text) => proxyFormFromYaml(text, cur)} rawLabel="节点 YAML" renderForm={() => <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="名称" className="col-span-2">{(id) => <Input id={id} value={cur.name} onChange={(x) => update({ name: x.target.value })} />}</Field>
                  <Field label="协议">{(id) => <Select id={id} value={cur.type} onChange={(x) => changeType(x.target.value)}>
                    {!PROXY_TYPES.some((type) => type.value === cur.type) && <option value={cur.type}>{cur.type}</option>}
                    {PROXY_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                  </Select>}</Field>
                  <Field label="端口">{(id) => <Input id={id} type="number" className="font-mono" value={cur.port || ''} onChange={(x) => update({ port: Number(x.target.value) })} />}</Field>
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
                <span className="text-[12px] leading-relaxed text-muted">保存的是引用，不是节点快照：上游节点改名或替换后，按引用重新解析。前置所在的节点集需要同时加入使用它的配置订阅；前置为策略组时，请在配置订阅的「代理链」中设置。<Link to="/profiles" className="text-accent">前往配置订阅</Link></span>
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
      <NewGroupModal open={creating} onClose={() => setCreating(false)} />
      <RenameDialog open={renaming} title="重命名分组" name={d.name} onClose={() => setRenaming(false)} onRename={(name) => e.setDraft({ ...d, name })} />
      <Modal title="离开前保存修改？" open={leaveTo !== undefined} onClose={() => setLeaveTo(undefined)}
        footer={<>
          <Button onClick={() => { const to = leaveTo!; setLeaveTo(undefined); e.setDraft(e.doc.data); navigate(to); }}>放弃修改</Button>
          <Button onClick={() => setLeaveTo(undefined)}>继续编辑</Button>
          <Button variant="primary" disabled={rawInvalid || e.save.isPending} onClick={() => { const to = leaveTo!; e.save.mutate(d, { onSuccess: () => { setLeaveTo(undefined); navigate(to); } }); }}>保存并离开</Button>
        </>}>
        <span className="text-[13.5px] leading-relaxed">分组「{d.name}」有未保存的修改。离开后修改会丢失。</span>
        <ErrorBox error={e.save.error} />
      </Modal>
    </>
  );
}
