// 基础设置预设（BS-03，设计稿「管理员 · 基础设置预设」）：一页完成——左侧预设列表、中间编辑（分区跳转 + 表单 / YAML）、右侧引用方。
// 保存即发布新版本，引用它的配置订阅随之更新，它们自己覆盖的项保持不变。

import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { DeleteMenu } from '../components/MoreMenu.tsx';
import { RenameDialog } from '../components/dialogs.tsx';
import { Button, Card, ErrorBox, Input, Modal, PageHeader, Segmented, cx } from '../components/ui.tsx';
import { useDocEditor } from '../components/useDocEditor.ts';
import { DualEditor, type EditorMode } from '../components/DualEditor.tsx';
import { SchemaForm } from '../components/SchemaForm.tsx';
import { baseFormFromYaml, baseFromYaml, baseToYaml } from '../convert/baseYaml.ts';
import { baseFromForm, baseToForm, mihomoBaseGroups } from '../schemas/mihomoBase.ts';
import { useList, useSaveDoc, type PresetDoc } from '../hooks.ts';

const INTRO = '预设更新会同步到所有引用它的配置订阅；配置订阅自己覆盖的项保持不变。';
const DEFAULT_MIHOMO = { 'mixed-port': 7890, mode: 'rule', 'log-level': 'warning' };
const EMPTY: PresetDoc = { id: '', name: '', version: 1, mihomo: DEFAULT_MIHOMO };

function NewPresetModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const save = useSaveDoc('presets');
  const [name, setName] = useState('');
  useEffect(() => { if (open) setName(''); }, [open]);
  const create = () => save.mutate({ name: name.trim(), version: 1, mihomo: DEFAULT_MIHOMO }, { onSuccess: (item) => { onClose(); navigate(`/presets/${item.id}`); } });
  return (
    <Modal title="新建预设" open={open} onClose={onClose}
      footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={!name.trim() || save.isPending} onClick={create}>{save.isPending ? '创建中…' : '创建'}</Button></>}>
      <label className="flex flex-col gap-1.5"><span className="text-[12.5px] font-medium text-muted">名称</span>
        <Input autoFocus placeholder="例如：fake-ip 推荐" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) create(); }} /></label>
      <span className="text-[12px] text-muted">从常用的通用设置开始，创建后再补充 DNS、TUN 等。</span>
      <ErrorBox error={save.error} />
    </Modal>
  );
}

/** /presets：有预设时跳到第一个，否则显示空状态 */
export function PresetList() {
  const list = useList('presets');
  const [creating, setCreating] = useState(false);
  if (list.isLoading) return <div className="text-muted">加载中…</div>;
  if (list.data?.length) return <Navigate to={`/presets/${list.data[0]!.id}`} replace />;
  return (
    <>
      <PageHeader title="基础设置预设" subtitle={INTRO} actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus size={16} />新建预设</Button>} />
      <ErrorBox error={list.error} />
      <section className="flex flex-col items-center gap-2 rounded-[10px] border border-dashed border-[#d5d9e0] bg-panel px-7 py-7 text-center">
        <span className="text-[14px] font-semibold">还没有预设</span>
        <span className="max-w-[420px] text-[12.5px] leading-relaxed text-muted">把 DNS、TUN、嗅探等通用设置做成预设，配置订阅引用后自动同步。</span>
        <Button size="sm" onClick={() => setCreating(true)}>新建预设</Button>
      </section>
      <NewPresetModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

export function PresetEdit() {
  const navigate = useNavigate();
  const e = useDocEditor('presets', EMPTY);
  const presets = useList('presets');
  const profiles = useList('profiles');
  const [rawValid, setRawValid] = useState(true);
  const [mode, setMode] = useState<EditorMode>('form');
  const [client, setClient] = useState<'mihomo' | 'surge'>('mihomo');
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  if (e.isNew) return <Navigate to="/presets" replace />;
  if (!e.draft) return e.doc.error ? <ErrorBox error={e.doc.error} /> : <div className="text-muted">加载中…</div>;
  const d = e.draft;
  const refs = (profiles.data ?? []).filter((p) => p.base?.presetId === d.id);
  const dirty = e.dirty || !rawValid;
  const publish = () => { if (rawValid) e.submit((x) => ({ ...x, version: x.version + 1 })); };
  const discard = () => e.setDraft(e.doc.data);
  const jump = (title: string) => document.querySelector(`[data-section="${title}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const refCount = (id: string) => (profiles.data ?? []).filter((p) => p.base?.presetId === id).length;

  return (
    <>
      <PageHeader title="基础设置预设" subtitle={INTRO} actions={<Button onClick={() => setCreating(true)}>新建预设</Button>} />
      <ErrorBox error={e.save.error} />
      <div className="flex flex-wrap items-start gap-5">
        <nav aria-label="预设列表" className="min-w-0 flex-[1_1_240px] overflow-hidden rounded-[10px] border border-line bg-panel py-1.5">
          {(presets.data ?? []).map((p) => {
            const on = p.id === d.id;
            return (
              <button key={p.id} type="button" aria-current={on || undefined} onClick={() => { if (!on && (!dirty || confirm(`「${d.name}」有未保存的修改，离开后会丢失。继续？`))) navigate(`/presets/${p.id}`); }}
                className={cx('flex w-full cursor-pointer flex-col gap-0.5 border-b border-line-2 px-4 py-3 text-left last:border-0', on ? 'bg-[#f5f8ff]' : 'bg-panel hover:bg-ground')}>
                <span className="text-[13.5px] font-semibold">{on ? d.name : p.name}</span>
                <span className="text-[12px] text-muted">v{p.version} · {refCount(p.id)} 个配置订阅引用</span>
              </button>
            );
          })}
        </nav>

        <section className="flex min-w-0 flex-[999_1_520px] flex-col gap-3.5 rounded-[10px] border border-line bg-panel px-4.5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <h2 className="m-0 text-[17px] font-semibold">{d.name}</h2>
            <div className="flex items-center gap-2">
              <Segmented label="客户端" value={client} options={[{ value: 'mihomo', label: 'mihomo' }, { value: 'surge', label: 'Surge' }]} onChange={setClient} />
              <DeleteMenu what="预设" name={d.name} body="引用它的配置订阅需要先改用其他预设或自定义。" error={e.del.error} pending={e.del.isPending} onReset={e.del.reset} onDelete={e.remove}
                extra={[{ label: '重命名…', onSelect: () => setRenaming(true) }]} />
            </div>
          </div>
          {client === 'surge' && <div className="rounded-lg border border-dashed border-[#d5d9e0] px-4 py-6 text-center text-[13px] text-muted">Surge 段（[General]、[Host]）在 M2 提供；目前预设只输出 mihomo。</div>}
          {client === 'mihomo' && mode === 'form' && <div className="flex flex-wrap gap-1.5">
            {mihomoBaseGroups.map((g) => <button key={g.title} type="button" onClick={() => jump(g.title)}
              className="cursor-pointer rounded-full border border-line bg-ground px-2.5 py-1 text-[12.5px] text-ink-2 hover:border-[#c5cad3]">{g.title}</button>)}
          </div>}
          {client === 'mihomo' && <DualEditor key={d.id} value={d.mihomo} onChange={(mihomo) => e.setDraft({ ...d, mihomo })} mode={mode} onModeChange={setMode}
            toRaw={baseToYaml} fromRaw={baseFromYaml} recoverForm={baseFormFromYaml} onValidityChange={setRawValid} rawLabel="mihomo · YAML"
            renderForm={() => <SchemaForm groups={mihomoBaseGroups} value={baseToForm(d.mihomo)} extra
              onChange={(value) => e.setDraft({ ...d, mihomo: baseFromForm(value, d.mihomo) })} />} />}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-2 pt-3.5">
            <span className={cx('text-[12.5px]', rawValid ? 'text-ok' : 'text-err')}>{rawValid ? (dirty ? `有未发布的修改 · 当前 v${d.version}` : `已发布 v${d.version}`) : '请先修复 YAML 中的错误'}</span>
            <div className="flex gap-2">
              <Button disabled={!e.dirty} onClick={discard}>放弃</Button>
              <Button variant="primary" disabled={!dirty || !rawValid || e.save.isPending} onClick={publish}>{e.save.isPending ? '发布中…' : `发布 v${d.version + 1}`}</Button>
            </div>
          </div>
        </section>

        <Card title={`引用方 · ${refs.length}`} className="min-w-0 flex-[1_1_260px]" bodyClass="px-4 pb-3">
          {refs.map((p) => {
            const overrides = Object.keys(p.base?.patch ?? {}).length;
            return (
              <div key={p.id} className="flex justify-between gap-2 border-t border-line-2 py-2.5 text-[13px] first:border-0 first:pt-0">
                <Link to={`/profiles/${p.id}/base`} className="font-medium text-ink no-underline hover:text-accent">{p.name}</Link>
                <span className="text-[12px] whitespace-nowrap text-muted">{overrides ? `覆盖 ${overrides} 项` : '无覆盖'}</span>
              </div>
            );
          })}
          {!refs.length && <span className="text-[13px] text-muted">你的配置订阅中还没有引用它的。</span>}
        </Card>
      </div>
      <NewPresetModal open={creating} onClose={() => setCreating(false)} />
      <RenameDialog open={renaming} title="重命名预设" name={d.name} onClose={() => setRenaming(false)} onRename={(name) => e.setDraft({ ...d, name })} />
    </>
  );
}
