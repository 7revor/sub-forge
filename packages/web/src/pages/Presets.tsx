// 基础设置预设（BS-03）：列表管理预设，独立详情页编辑配置并查看引用方。
// 保存即发布新版本，引用它的配置订阅随之更新，它们自己覆盖的项保持不变。

import { useState } from 'react';
import { useLeaveGuard } from '../hooks/useLeaveGuard.ts';
import { LeaveDialog } from '../components/LeaveDialog.tsx';
import { NamedCreateDialog } from '../components/NamedCreateDialog.tsx';
import { Link, Navigate, useNavigate } from 'react-router';
import { DocList } from '../components/DocList.tsx';
import { DeleteAction, ActionButtons } from '../components/DetailActions.tsx';
import { RenameDialog } from '../components/dialogs.tsx';
import { Button, Card, Empty, ErrorBox, PageHeader, PageScroll, Segmented, cx } from '../components/ui.tsx';
import { useDocEditor } from '../components/useDocEditor.ts';
import { DualEditor, type EditorMode } from '../components/DualEditor.tsx';
import { SchemaForm } from '../components/SchemaForm.tsx';
import { baseFormFromYaml, baseFromYaml, baseToYaml } from '../convert/baseYaml.ts';
import { baseFromForm, baseToForm, mihomoBaseGroups } from '../schemas/mihomoBase.ts';
import { useList, useSaveDoc, type PresetDoc } from '../hooks.ts';

const INTRO = '预设更新会同步到所有引用它的配置订阅；配置订阅自己覆盖的项保持不变。';
const DELETE_BODY = '引用它的配置订阅需要先改用其他预设或自定义。';
const DEFAULT_MIHOMO = { 'mixed-port': 7890, mode: 'rule', 'log-level': 'warning' };
const EMPTY: PresetDoc = { id: '', name: '', version: 1, mihomo: DEFAULT_MIHOMO };

function NewPresetModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const save = useSaveDoc('presets');
  return <NamedCreateDialog open={open} onClose={onClose} title="新建预设" placeholder="例如：fake-ip 推荐" hint="从常用的通用设置开始，创建后再补充 DNS、TUN 等。"
    pending={save.isPending} error={save.error} onReset={save.reset}
    onCreate={(name) => save.mutateAsync({ name, version: 1, mihomo: DEFAULT_MIHOMO }, { onSuccess: (item) => { onClose(); navigate(`/presets/${item.id}`); } })} />;
}

/** /presets：与订阅源、组合一致的列表入口 */
export function PresetList() {
  const profiles = useList('profiles');
  const [creating, setCreating] = useState(false);
  return (
    <>
      <ErrorBox error={profiles.error} />
      <DocList kind="presets" title="基础设置预设" noun="预设" intro={INTRO} onCreate={() => setCreating(true)} deleteBody={DELETE_BODY}
        empty="把 DNS、TUN、嗅探等通用设置做成预设，配置订阅引用后自动同步。"
        columns={[
          { header: '名称', cell: (p) => p.name },
          { header: '已发布版本', cell: (p) => <span className="font-mono text-[13px]">v{p.version}</span> },
          { header: '引用方', cell: (p) => profiles.isLoading ? '加载中…' : profiles.error ? '加载失败' : `${(profiles.data ?? []).filter((profile) => profile.base?.presetId === p.id).length} 个配置订阅` },
        ]} />
      <NewPresetModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

export function PresetEdit() {
  const e = useDocEditor('presets', EMPTY);
  const profiles = useList('profiles');
  const [rawValid, setRawValid] = useState(true);
  const [mode, setMode] = useState<EditorMode>('form');
  const [client, setClient] = useState<'mihomo' | 'surge'>('mihomo');
  const [renaming, setRenaming] = useState(false);
  const [editorRevision, setEditorRevision] = useState(0);
  const dirty = !!e.draft && (e.dirty || !rawValid);
  const { blocker, leave } = useLeaveGuard(!e.isNew && dirty);
  if (e.isNew) return <Navigate to="/presets" replace />;
  if (!e.draft) return e.doc.error ? <ErrorBox error={e.doc.error} /> : <div className="text-muted">加载中…</div>;
  const d = e.draft;
  const refs = (profiles.data ?? []).filter((p) => p.base?.presetId === d.id);
  const publish = () => { if (rawValid) e.submit((x) => ({ ...x, version: x.version + 1 })); };
  const discard = () => {
    e.setDraft(e.doc.data);
    setRawValid(true);
    setEditorRevision((value) => value + 1);
  };

  return (
    <>
      <PageHeader title={d.name} subtitle={INTRO}
        crumbs={<><Link to="/presets" className="text-muted no-underline hover:text-accent">基础设置预设</Link> / {e.doc.data?.name}</>}
        actions={<>
          <ActionButtons items={[{ label: '重命名', onSelect: () => setRenaming(true) }]} />
          <Button disabled={!dirty || e.save.isPending} onClick={discard}>放弃</Button>
          <Button variant="primary" disabled={!dirty || !rawValid || e.save.isPending} onClick={publish}>{e.save.isPending ? '发布中…' : `发布 v${d.version + 1}`}</Button>
          <DeleteAction what="预设" name={d.name} body={DELETE_BODY} error={e.del.error} pending={e.del.isPending} onReset={e.del.reset}
            onDelete={() => e.del.mutate(d.id, { onSuccess: () => leave('/presets') })} />
        </>}>
        <span className={cx('text-[12.5px]', rawValid ? 'text-ok' : 'text-err')}>{rawValid ? (dirty ? `有未发布的修改 · 当前 v${d.version}` : `已发布 v${d.version}`) : '请先修复 YAML 中的错误'}</span>
      </PageHeader>
      <ErrorBox error={e.save.error} />
      <PageScroll>
        <div className="flex flex-wrap items-start gap-5">
          <section className="flex min-w-0 flex-[999_1_520px] flex-col gap-3.5 rounded-[10px] border border-line bg-panel px-4.5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <h2 className="m-0 text-[17px] font-semibold">基础设置</h2>
              <div className="flex flex-wrap items-center gap-2">
                <Segmented label="客户端" value={client} options={[{ value: 'mihomo', label: 'mihomo' }, { value: 'surge', label: 'Surge' }]} onChange={setClient} />
              </div>
            </div>
            {client === 'surge' && <Empty title="Surge 预设暂未开放" description="Surge 段（[General]、[Host]）在 M2 提供；目前预设只输出 mihomo。" />}
            {client === 'mihomo' && <DualEditor key={`${d.id}-${editorRevision}`} value={d.mihomo} onChange={(mihomo) => e.setDraft({ ...d, mihomo })} mode={mode} onModeChange={setMode}
              toRaw={baseToYaml} fromRaw={baseFromYaml} recoverForm={baseFormFromYaml} onValidityChange={setRawValid} rawLabel="mihomo · YAML"
              renderForm={() => <SchemaForm groups={mihomoBaseGroups} value={baseToForm(d.mihomo)} extra collapsible
                onChange={(value) => e.setDraft({ ...d, mihomo: baseFromForm(value, d.mihomo) })} />} />}
          </section>

          <Card title={`引用方${profiles.data ? ` · ${refs.length}` : ''}`} className="min-w-0 flex-[1_1_260px]" bodyClass="px-4 pb-3">
            <ErrorBox error={profiles.error} />
            {profiles.isLoading && <span className="text-muted">加载中…</span>}
            {refs.map((p) => {
              const overrides = Object.keys(p.base?.patch ?? {}).length;
              return (
                <div key={p.id} className="flex justify-between gap-2 border-t border-line-2 py-2.5 text-[13px] first:border-0 first:pt-0">
                  <Link to={`/profiles/${p.id}/base`} className="font-medium text-ink no-underline hover:text-accent">{p.name}</Link>
                  <span className="text-[12px] whitespace-nowrap text-muted">{overrides ? `覆盖 ${overrides} 项` : '无覆盖'}</span>
                </div>
              );
            })}
            {profiles.data && !refs.length && <Empty title="还没有配置订阅引用它" />}
          </Card>
        </div>
      </PageScroll>
      <RenameDialog open={renaming} title="重命名预设" name={d.name} onClose={() => setRenaming(false)} onRename={(name) => e.setDraft({ ...d, name })} />
      <LeaveDialog blocker={blocker} what={`预设「${d.name}」`} canSave={rawValid} pending={e.save.isPending} error={e.save.error} onDiscard={discard} saveLabel="发布并离开"
        onSave={(done) => e.save.mutate({ ...d, version: d.version + 1 }, { onSuccess: done })} />
    </>
  );
}
