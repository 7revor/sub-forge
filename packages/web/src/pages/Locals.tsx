// 本地节点（LOC-01）：与订阅源一致的三层页面——
// /locals 分组列表 → /locals/:id 分组详情（节点表、粘贴导入、分组 YAML）→ /locals/:id/nodes/:index 节点编辑子页（表单 / YAML）。
// 本地节点只录入节点信息，不设置前置：代理链统一在配置订阅的「代理链」中配置（REF-03）。
// 每个分组是一个节点集文档；节点子页直接保存整个分组。离开有未保存修改的页面前先确认。

import type { LocalProxy, LocalProxyGroup } from '@sub-forge/core';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useBeforeUnload, useBlocker, useLocation, useNavigate, useParams, type Blocker, type NavigateOptions } from 'react-router';
import { DocList } from '../components/DocList.tsx';
import { DocActionLink, DocTableRow, actionHeader, docNameLinkClass } from '../components/DocTableRow.tsx';
import { DualEditor } from '../components/DualEditor.tsx';
import { SchemaForm } from '../components/SchemaForm.tsx';
import { defaultsFor, PROXY_TYPES, schemaFor } from '../schemas/proxy.ts';
import { groupFromYaml, groupToYaml, parseProxyImport, proxyDraftFromYaml, proxyFormFromYaml, proxyToYaml } from '../convert/proxyYaml.ts';
import { DeleteAction, DeleteDialog, MoreMenu } from '../components/MoreMenu.tsx';
import { RenameDialog } from '../components/dialogs.tsx';
import { Badge, Button, buttonClass, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, Select, Textarea, cx, td, th } from '../components/ui.tsx';
import { useDocEditor } from '../components/useDocEditor.ts';
import { useDoc, useSaveDoc } from '../hooks.ts';

const INTRO = '自建、中转等手写节点。每个分组就是一个节点集，可单独加入配置订阅。';
const EMPTY: LocalProxyGroup = { id: '', name: '', proxies: [] };
const CORE = new Set(['name', 'type', 'server', 'port']);
const crumbLink = 'text-muted no-underline';

/** 有未保存修改时拦截站内跳转与关闭页面；leave 用于保存/删除成功后的主动跳转，不再拦截 */
function useLeaveGuard(dirty: boolean) {
  const navigate = useNavigate();
  const location = useLocation();
  const skip = useRef(false);
  useEffect(() => { skip.current = false; }, [location.key]);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !skip.current && currentLocation.pathname !== nextLocation.pathname);
  useBeforeUnload(useCallback((event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } }, [dirty]));
  const leave = (to: string, options?: NavigateOptions) => { skip.current = true; void navigate(to, options); };
  return { blocker, leave };
}

function LeaveModal({ blocker, what, canSave, pending, error, onSave }: {
  blocker: Blocker; what: string; canSave: boolean; pending: boolean; error: unknown; onSave: (done: () => void) => void;
}) {
  const blocked = blocker.state === 'blocked';
  const stay = () => { if (blocked) blocker.reset(); };
  return (
    <Modal title="离开前保存修改？" open={blocked} onClose={stay}
      footer={<>
        <Button onClick={() => { if (blocked) blocker.proceed(); }}>放弃修改</Button>
        <Button onClick={stay}>继续编辑</Button>
        <Button variant="primary" disabled={!canSave || pending} onClick={() => onSave(() => { if (blocker.state === 'blocked') blocker.proceed(); })}>{pending ? '保存中…' : '保存并离开'}</Button>
      </>}>
      <span className="text-[13.5px] leading-relaxed">{what}有未保存的修改。离开后修改会丢失。</span>
      <ErrorBox error={error} />
    </Modal>
  );
}

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

const typesText = (g: LocalProxyGroup) => [...new Set(g.proxies.map((p) => p.type))].join(' / ') || '—';

const GROUP_DELETE_BODY = '分组里的节点会一起删除；引用它的配置订阅需要先移除。';

/** /locals：分组列表，与订阅源列表同一形态 */
export function LocalList() {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <DocList kind="locals" title="本地节点" noun="分组" onCreate={() => setCreating(true)} intro={INTRO} deleteBody={GROUP_DELETE_BODY}
        empty="自建、中转等手写节点按分组管理，每个分组都能单独加入配置订阅。"
        columns={[
          { header: '名称', cell: (g) => g.name },
          { header: '节点', cell: (g) => <span className="font-mono text-[13px]">{g.proxies.length}</span> },
          { header: '协议', cell: (g) => <span className="font-mono text-[12.5px] text-ink-2">{typesText(g)}</span> },
        ]} />
      <NewGroupModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function PasteModal({ open, onClose, onImport }: { open: boolean; onClose: () => void; onImport: (p: LocalProxy[]) => void }) {
  const [text, setText] = useState('');
  const parsed = text.trim() ? parseProxyImport(text) : undefined;
  // 本地节点不处理代理链：节点自带的 dialer-proxy / underlying-proxy 不导入，并提示到配置订阅中设置
  const proxies: LocalProxy[] = (parsed?.proxies ?? []).map(({ _source, _origName, _key, upstreamDialer, ...rest }) => rest as LocalProxy);
  const dropped = (parsed?.proxies ?? []).filter((p) => p.upstreamDialer).length;
  return (
    <Modal title="粘贴导入节点" open={open} onClose={onClose} wide
      footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={!proxies.length} onClick={() => { onImport(proxies); setText(''); onClose(); }}>导入 {proxies.length} 个节点</Button></>}>
      <Field label="URI 列表、Base64、Clash YAML 或 Surge [Proxy] 行" hint="YAML 支持单个节点、节点列表或带 proxies 的完整配置。">
        {(id) => <Textarea id={id} rows={8} className="font-mono text-[12.5px]" value={text} onChange={(e) => setText(e.target.value)} />}
      </Field>
      {parsed && <div className="flex flex-wrap gap-2">
        <Badge tone={proxies.length ? 'ok' : 'neutral'}>识别为 {parsed.format} · {proxies.length} 个节点</Badge>
        {parsed.failures.length > 0 && <Badge tone="err">{parsed.failures.length} 行无法解析</Badge>}
        {dropped > 0 && <Badge tone="warn">{dropped} 个节点自带前置，不会导入</Badge>}
      </div>}
      {dropped > 0 && <span className="text-[12.5px] leading-relaxed text-muted">本地节点只保存节点信息。需要经中转连接时，请在配置订阅的「代理链」中添加链规则。</span>}
      {parsed?.failures.length ? <ul className="m-0 pl-5 font-mono text-[12px] text-err">{parsed.failures.map((f, i) => <li key={i}>{f.line.slice(0, 60)} — {f.reason}</li>)}</ul> : null}
    </Modal>
  );
}

/** /locals/:id：分组详情，节点表的「编辑」「新增节点」进入节点子页 */
export function LocalEdit() {
  const e = useDocEditor('locals', EMPTY);
  const [pasting, setPasting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [groupText, setGroupText] = useState<string>();
  const [deletingNode, setDeletingNode] = useState<number>();
  const { blocker, leave } = useLeaveGuard(e.dirty && !e.isNew);
  if (e.isNew) return <Navigate to="/locals" replace />;
  if (!e.draft) return e.doc.error ? <ErrorBox error={e.doc.error} /> : <div className="text-muted">加载中…</div>;
  const d = e.draft;
  const setProxies = (proxies: LocalProxy[]) => e.setDraft({ ...d, proxies });
  const groupResult = groupText === undefined ? undefined : groupFromYaml(groupText);
  const nodePath = (i: number | 'new') => `/locals/${d.id}/nodes/${i}`;

  return (
    <>
      <PageHeader crumbs={<><Link to="/locals" className={crumbLink}>本地节点</Link> / {e.doc.data?.name}</>}
        title={d.name || '未命名'}
        actions={<>
          <MoreMenu items={[{ label: '重命名分组…', onSelect: () => setRenaming(true) }, { label: '分组 YAML…', onSelect: () => setGroupText(groupToYaml(d.proxies)) }]} />
          <Button variant="primary" onClick={() => e.submit()} disabled={e.save.isPending || !e.dirty}>{e.save.isPending ? '保存中…' : e.dirty ? '保存分组' : '已保存'}</Button>
          <DeleteAction what="分组" name={d.name} body={GROUP_DELETE_BODY} error={e.del.error} pending={e.del.isPending} onReset={e.del.reset}
            onDelete={() => e.del.mutate(d.id, { onSuccess: () => leave('/locals') })} />
        </>}>
        <Badge>{d.proxies.length} 个节点</Badge>
        {e.dirty && <Badge tone="warn">有未保存的修改</Badge>}
      </PageHeader>
      <ErrorBox error={e.save.error} />

      <Card bodyClass="overflow-x-auto"
        title={<h2 className="m-0 text-[15px] font-semibold">节点</h2>}
        actions={<><Button size="sm" onClick={() => setPasting(true)}>粘贴导入</Button><Link to={nodePath('new')} className={buttonClass('default', 'sm')}><Plus size={14} />新增节点</Link></>}>
        {!d.proxies.length ? <div className="px-4 pb-4"><Empty title="这个分组还没有节点" description="新增一个，或粘贴 URI / YAML 一次导入多个。" /></div> : (
          <table className="w-full min-w-[620px] border-collapse">
            <thead><tr><th className={cx(th, 'px-3.5')}>名称</th><th className={cx(th, 'px-3.5')}>协议</th><th className={cx(th, 'px-3.5')}>服务器</th><th className={cx(th, 'w-px')}>{actionHeader}</th></tr></thead>
            <tbody>
              {d.proxies.map((p, i) => (
                <DocTableRow key={i} to={nodePath(i)}>
                  <td className={cx(td, 'px-3.5 py-3 whitespace-nowrap')}><Link to={nodePath(i)} className={docNameLinkClass}>{p.name}</Link></td>
                  <td className={cx(td, 'px-3.5 py-3')}><span className="rounded bg-[#ebedf1] px-1.5 py-0.5 font-mono text-[12px]">{p.type}</span></td>
                  <td className={cx(td, 'px-3.5 py-3 font-mono text-[12.5px] text-ink-2')}>{p.server}:{p.port}</td>
                  <td className={cx(td, 'text-right whitespace-nowrap')}>
                    <Button size="sm" variant="danger" aria-label={`删除 ${p.name}`} className="mr-2" onClick={() => { e.save.reset(); setDeletingNode(i); }}>删除</Button>
                    <DocActionLink to={nodePath(i)} name={p.name} />
                  </td>
                </DocTableRow>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal title="分组 YAML" open={groupText !== undefined} onClose={() => setGroupText(undefined)} wide
        footer={<><Button onClick={() => setGroupText(undefined)}>取消</Button><Button variant="primary" disabled={!groupResult?.ok} onClick={() => {
          if (groupResult?.ok) { setProxies(groupResult.value); setGroupText(undefined); }
        }}>应用到分组</Button></>}>
        <Field label="整个分组的 proxies 列表" hint="应用后请保存分组。本地节点不设置前置，代理链请在配置订阅中设置。">
          {(id) => <Textarea id={id} rows={18} className="font-mono" spellCheck={false} value={groupText ?? ''} onChange={(event) => setGroupText(event.target.value)} />}
        </Field>
        <ErrorBox error={groupResult && !groupResult.ok ? `第 ${groupResult.line ?? 1} 行：${groupResult.error}` : undefined} />
      </Modal>
      <DeleteDialog open={deletingNode !== undefined} title={`删除节点「${deletingNode === undefined ? '' : d.proxies[deletingNode]?.name ?? ''}」？`} error={e.save.error} pending={e.save.isPending}
        onClose={() => setDeletingNode(undefined)}
        onConfirm={() => e.save.mutate({ ...d, proxies: d.proxies.filter((_, i) => i !== deletingNode) }, { onSuccess: () => setDeletingNode(undefined) })}>
        节点会从分组「{d.name}」中移除并立即保存{e.dirty ? '；分组里其他未保存的修改也会一起保存' : ''}。
      </DeleteDialog>
      <PasteModal open={pasting} onClose={() => setPasting(false)} onImport={(ps) => setProxies([...d.proxies, ...ps])} />
      <RenameDialog open={renaming} title="重命名分组" name={d.name} onClose={() => setRenaming(false)} onRename={(name) => e.setDraft({ ...d, name })} />
      <LeaveModal blocker={blocker} what={`分组「${d.name}」`} canSave pending={e.save.isPending} error={e.save.error}
        onSave={(done) => e.save.mutate(d, { onSuccess: done })} />
    </>
  );
}

/** /locals/:id/nodes/:index（index 为 new 时新增）：单个节点的编辑子页，保存即写回整个分组 */
export function LocalNodeEdit() {
  const { id, index } = useParams();
  const isNew = index === 'new';
  const idx = Number(index);
  const doc = useDoc('locals', id);
  const save = useSaveDoc('locals');
  const [base, setBase] = useState<LocalProxy>();
  const [draft, setDraft] = useState<LocalProxy>();
  const [rawValid, setRawValid] = useState(true);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    if (!doc.data) return;
    const p = isNew ? { ...defaultsFor('trojan'), name: `节点 ${doc.data.proxies.length + 1}` } as LocalProxy : doc.data.proxies[idx];
    setBase(p); setDraft(p);
  }, [doc.data, index]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(base);
  const { blocker, leave } = useLeaveGuard(dirty);
  const groupPath = `/locals/${id}`;

  if (doc.error) return <ErrorBox error={doc.error} />;
  if (!doc.data) return <div className="text-muted">加载中…</div>;
  const g = doc.data;
  if (!isNew && !(Number.isInteger(idx) && idx >= 0 && idx < g.proxies.length)) return <Navigate to={groupPath} replace />;
  if (!draft) return <div className="text-muted">加载中…</div>;

  const cur = draft;
  const update = (patch: Partial<LocalProxy>) => setDraft({ ...cur, ...patch });
  const changeType = (type: string) => {
    if (type === cur.type) return;
    const removed = Object.keys(cur).filter((key) => !CORE.has(key));
    if (removed.length && !confirm(`切换协议将清除以下协议配置：${removed.join('、')}。是否继续？`)) return;
    setDraft({ ...defaultsFor(type), name: cur.name, server: cur.server, port: cur.port });
  };
  const persist = (done?: () => void) => {
    if (!rawValid) return;
    const proxies = isNew ? [...g.proxies, cur] : g.proxies.map((p, i) => (i === idx ? cur : p));
    save.mutate({ ...g, proxies }, { onSuccess: () => {
      if (done) done();
      else if (isNew) leave(`${groupPath}/nodes/${proxies.length - 1}`, { replace: true });
    } });
  };
  const remove = () => save.mutate({ ...g, proxies: g.proxies.filter((_, i) => i !== idx) }, { onSuccess: () => leave(groupPath) });

  return (
    <>
      <PageHeader crumbs={<><Link to="/locals" className={crumbLink}>本地节点</Link> / <Link to={groupPath} className={crumbLink}>{g.name}</Link> / {isNew ? '新增节点' : base?.name}</>}
        title={isNew ? '新增节点' : cur.name || '未命名'}
        actions={<>
          <Button variant="primary" onClick={() => persist()} disabled={save.isPending || !rawValid || !(dirty || isNew)}>{save.isPending ? '保存中…' : isNew ? '添加到分组' : dirty ? '保存节点' : '已保存'}</Button>
          {!isNew && <Button variant="danger" onClick={() => { save.reset(); setDeleting(true); }}>删除</Button>}
        </>}>
        <Badge>分组 · {g.name}</Badge>
        {!isNew && dirty && <Badge tone="warn">有未保存的修改</Badge>}
      </PageHeader>
      <ErrorBox error={save.error} />

      <Card title={<h2 className="m-0 text-[15px] font-semibold">节点配置</h2>}>
        <DualEditor key={`${g.id}-${index}`} onValidityChange={setRawValid} value={cur} onChange={setDraft} toRaw={proxyToYaml} fromRaw={proxyDraftFromYaml} recoverForm={proxyFormFromYaml} rawLabel="节点 YAML" renderForm={() => <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="名称" className="col-span-2">{(fid) => <Input id={fid} value={cur.name} onChange={(x) => update({ name: x.target.value })} />}</Field>
            <Field label="协议">{(fid) => <Select id={fid} value={cur.type} onChange={(x) => changeType(x.target.value)}>
              {!PROXY_TYPES.some((type) => type.value === cur.type) && <option value={cur.type}>{cur.type}</option>}
              {PROXY_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </Select>}</Field>
            <Field label="端口">{(fid) => <Input id={fid} type="number" className="font-mono" value={cur.port || ''} onChange={(x) => update({ port: Number(x.target.value) })} />}</Field>
            <Field label="服务器" className="col-span-2">{(fid) => <Input id={fid} className="font-mono" value={cur.server} onChange={(x) => update({ server: x.target.value })} />}</Field>
          </div>
          <SchemaForm groups={schemaFor(cur.type)} extra
            value={Object.fromEntries(Object.entries(cur).filter(([key]) => !CORE.has(key)))}
            onChange={(value) => setDraft({ ...Object.fromEntries(Object.entries(cur).filter(([key]) => CORE.has(key))), ...Object.fromEntries(Object.entries(value).filter(([key]) => !CORE.has(key))) } as LocalProxy)} />
        </div>} />
      </Card>

      <DeleteDialog open={deleting} title={`删除节点「${base?.name ?? ''}」？`} error={save.error} pending={save.isPending}
        onClose={() => setDeleting(false)} onConfirm={remove}>
        节点会从分组「{g.name}」中移除并立即保存。
      </DeleteDialog>
      <LeaveModal blocker={blocker} what={isNew ? '新节点' : `节点「${base?.name ?? ''}」`} canSave={rawValid} pending={save.isPending} error={save.error}
        onSave={(done) => persist(done)} />
    </>
  );
}
