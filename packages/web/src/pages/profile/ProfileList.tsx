// 配置订阅列表与新建（PRD 4.9 向导的前三步：名称与基础设置、节点集、模板；其余在详情页各标签完成）。

import type { NodeSetID } from '@sub-forge/core';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { DocList } from '../../components/DocList.tsx';
import { useNodeSetNames } from '../../components/pickers.tsx';
import { Badge, Button, Card, ErrorBox, Field, Input, PageHeader, Select, cx } from '../../components/ui.tsx';
import { useList, useSaveDoc, useTemplates } from '../../hooks.ts';

export function ProfileList() {
  const templates = useTemplates().data ?? [];
  return (
    <DocList kind="profiles" title="配置订阅" intro="交付给客户端的整体订阅：模板只管分流，这里填充节点、调整组与规则、配置代理链。"
      columns={[
        { header: '名称', cell: (p) => p.name },
        { header: '模板', cell: (p) => p.template ? <>{templates.find((t) => t.id === p.template!.id)?.name ?? p.template.id} <Badge>{p.template.follow === 'latest' ? '跟随最新' : `锁定 v${p.template.follow.pinned}`}</Badge></> : '—' },
        { header: '节点集', cell: (p) => <span className="font-mono">{p.nodeSets.length}</span> },
        { header: '代理链', cell: (p) => <span className="font-mono">{p.chains.length}</span> },
      ]} />
  );
}

export function ProfileNew() {
  const navigate = useNavigate();
  const templates = useTemplates().data ?? [];
  const presets = useList('presets').data ?? [];
  const { all: nodeSets } = useNodeSetNames();
  const save = useSaveDoc('profiles');
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [presetId, setPresetId] = useState('');
  const [picked, setPicked] = useState<NodeSetID[]>([]);
  const isPicked = (r: NodeSetID) => picked.some((p) => p.type === r.type && p.id === r.id);

  const create = () => save.mutate({
    name,
    nodeSets: picked.map((ref) => ({ ref, output: 'provider' as const })),
    overlay: {}, chains: [], refPolicy: { default: 'wrap' },
    ...(templateId ? { template: { id: templateId, follow: 'latest' as const } } : {}),
    ...(presetId ? { base: { presetId } } : {}),
  }, { onSuccess: (p) => navigate(`/profiles/${p.id}/groups`) });

  return (
    <>
      <PageHeader crumbs={<><Link to="/profiles" className="text-muted no-underline">配置订阅</Link> / 新建</>} title="新建配置订阅" />
      <Card title="1 · 名称与基础设置">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
          <Field label="名称" hint="客户端里显示的订阅名">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="基础设置" hint="通用、DNS、TUN 等；可以之后再改">{(id) => (
            <Select id={id} value={presetId} onChange={(e) => setPresetId(e.target.value)}>
              <option value="">不输出（使用客户端默认）</option>
              {presets.map((p) => <option key={p.id} value={p.id}>预设：{p.name}</option>)}
            </Select>
          )}</Field>
        </div>
      </Card>
      <Card title="2 · 节点集" actions={<span className="text-[12.5px] text-muted">默认以 provider 输出；代理链用到的节点不用在这里添加</span>}>
        {nodeSets.length === 0 ? <p className="m-0 text-[13px] text-muted">还没有订阅源。<Link to="/sources/new" className="text-accent">先添加一个</Link></p> : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2.5">
            {nodeSets.map((n) => {
              const on = isPicked(n.ref);
              return (
                <button key={`${n.ref.type}:${n.ref.id}`} type="button" aria-pressed={on} onClick={() => setPicked(on ? picked.filter((p) => !(p.type === n.ref.type && p.id === n.ref.id)) : [...picked, n.ref])}
                  className={cx('flex cursor-pointer flex-col gap-0.5 rounded-[10px] border px-3.5 py-3 text-left', on ? 'border-accent bg-[#f5f8ff]' : 'border-[#d5d9e0] bg-panel')}>
                  <span className="text-[13.5px] font-medium">{n.name}</span>
                  <span className="text-[12px] text-muted">{n.ref.type === 'source' ? '订阅源' : n.ref.type === 'collection' ? '组合' : '本地节点组'}</span>
                </button>
              );
            })}
          </div>
        )}
      </Card>
      <Card title="3 · 模板">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2.5">
          {[{ id: '', name: '空白', desc: '不使用模板，只用私有组和私有规则' }, ...templates.map((t) => ({ id: t.id, name: `${t.name ?? t.id} v${t.version}`, desc: `${t.groups.length} 个组 · ${t.rules.length} 条规则` }))].map((t) => (
            <button key={t.id || 'blank'} type="button" aria-pressed={templateId === t.id} onClick={() => setTemplateId(t.id)}
              className={cx('flex cursor-pointer flex-col gap-0.5 rounded-[10px] border px-3.5 py-3 text-left', templateId === t.id ? 'border-accent bg-[#f5f8ff]' : 'border-[#d5d9e0] bg-panel')}>
              <span className="text-[13.5px] font-semibold">{t.name}</span>
              <span className="text-[12.5px] text-muted">{t.desc}</span>
            </button>
          ))}
        </div>
        {templateId && <p className="mt-3 mb-0 text-[12.5px] text-muted">跟随最新版本：模板发布后立即生效。可以在详情页改为锁定某个版本。</p>}
      </Card>
      <ErrorBox error={save.error} />
      <div className="flex justify-end gap-2">
        <Link to="/profiles" className="inline-flex h-10 items-center rounded-lg border border-[#d5d9e0] bg-panel px-3.5 text-[13.5px] text-ink no-underline">取消</Link>
        <Button variant="primary" disabled={!name.trim() || save.isPending} onClick={create}>创建并填充策略组</Button>
      </div>
    </>
  );
}
