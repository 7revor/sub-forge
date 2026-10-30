import { NativeBaseEditor } from '../components/NativeBaseEditor.tsx';
// 基础设置预设（BS-03）：列表管理预设，独立详情页编辑配置并查看引用方。
// 保存即发布新版本，引用它的配置订阅随之更新，它们自己覆盖的项保持不变。

import { useLeaveGuard } from '../hooks/useLeaveGuard.ts';
import { NamedCreateDialog } from '../components/NamedCreateDialog.tsx';
import { Link, Navigate, useNavigate } from 'react-router';
import { DocList } from '../components/DocList.tsx';
import { DeleteAction, ActionButtons } from '../components/DetailActions.tsx';
import { Frame } from '../modals/Frame.tsx';
import { Button, Card, Empty, ErrorAlert, PageHeader, PageScroll } from '../components/ui.tsx';
import { useDocEditor } from '../components/useDocEditor.ts';
import { useList, useSaveDoc, type PresetDoc } from '../hooks.ts';

const INTRO = '保存后同步更新引用此预设的配置订阅。';
const DELETE_BODY = '引用它的配置订阅需要先改用其他预设或自定义。';
const EMPTY: PresetDoc = { id: '', name: '', version: 1, config: {} };

/** /presets：与订阅源、组合一致的列表入口 */
export function PresetList() {
  const profiles = useList('profiles');
  const navigate = useNavigate();
  const save = useSaveDoc('presets', true);
  const create = async () => {
    let createdId: string | undefined;
    const result = await NamedCreateDialog.show({ title: '新建预设', placeholder: '例如：fake-ip 推荐' }, { submit: async ({ name }) => { const item = await save.mutateAsync({ name, version: 1, config: {} }); createdId = item.id; } });
    if (result.status === 'confirmed' && createdId) navigate(`/presets/${createdId}`);
  };
  return (
    <>
      <ErrorAlert error={profiles.error} />
      <DocList kind="presets" title="基础设置预设" noun="预设" intro={INTRO} onCreate={create} deleteBody={DELETE_BODY}
        columns={[
          { header: '名称', cell: (p) => p.name },
          { header: '已发布版本', width: 160, cell: (p) => <span className="font-mono text-[13px]">v{p.version}</span> },
          { header: '引用方', width: 200, cell: (p) => profiles.isLoading ? '加载中…' : profiles.error ? '加载失败' : `${(profiles.data ?? []).filter((profile) => profile.base?.presetId === p.id).length} 个配置订阅` },
        ]} />
    </>
  );
}

export function PresetEdit() {
  const e = useDocEditor('presets', EMPTY);
  const profiles = useList('profiles');
  const dirty = e.dirty;
  const { leave } = useLeaveGuard(!e.isNew && dirty, undefined, () => ({ what: `预设「${d.name}」`, canSave: true, saveLabel: '发布并离开', onSave: () => e.save.mutateAsync({ ...d, version: d.version + 1 }), onDiscard: discard }));
  if (e.isNew) return <Navigate to="/presets" replace />;
  if (!e.draft) return e.doc.error ? <ErrorAlert error={e.doc.error} /> : <div className="text-ink-muted">加载中…</div>;
  const d = e.draft;
  const refs = (profiles.data ?? []).filter((p) => p.base?.presetId === d.id);
  const publish = () => { e.submit((x) => ({ ...x, version: x.version + 1 })); };
  const discard = () => {
    e.setDraft(e.doc.data);
  };

  return (
    <>
      <PageHeader title={d.name} subtitle={INTRO}
        crumbs={<><Link to="/presets" className="text-ink-muted no-underline hover:text-brand">基础设置预设</Link> / {e.doc.data?.name}</>}
        actions={<>
          <ActionButtons items={[{ label: '重命名', onSelect: async () => { const result = await Frame.modal.prompt({ title: '重命名预设', initialValue: d.name, unchangedValue: d.name, placeholder: '填写新的预设名称' }); if (result.status === 'confirmed') e.setDraft({ ...d, name: result.data }); } }]} />
          <Button disabled={!dirty || e.save.isPending} onClick={discard}>放弃</Button>
          <Button variant="primary" disabled={!dirty || e.save.isPending} onClick={publish}>{e.save.isPending ? '发布中…' : `发布 v${d.version + 1}`}</Button>
          <DeleteAction what="预设" name={d.name} body={DELETE_BODY} error={e.del.error} pending={e.del.isPending} onReset={e.del.reset}
            onDelete={() => e.del.mutateAsync(d.id)} onDeleted={() => leave('/presets')} />
        </>}>
        <span className="text-[12.5px] text-ok">{dirty ? `有未发布的修改 · 当前 v${d.version}` : `已发布 v${d.version}`}</span>
      </PageHeader>
      <ErrorAlert error={e.save.error} />
      <PageScroll>
        <div className="flex flex-wrap items-start gap-5">
          <section className="flex min-w-0 flex-[999_1_520px] flex-col gap-3.5 rounded-[10px] border border-line bg-panel px-4.5 py-4">
            <h2 className="m-0 text-[17px] font-semibold">基础配置追加</h2>
            {(d.migrationNotes ?? []).map((note, i) => <p key={i} role="status" className="text-[13px] text-warn">{note}</p>)}
            <NativeBaseEditor value={d.config} preset onChange={config => e.setDraft({ ...d, config })} />
          </section>

          <Card title={`引用方${profiles.data ? ` · ${refs.length}` : ''}`} className="min-w-0 flex-[1_1_260px]" bodyClass="px-4 pb-3">
            <ErrorAlert error={profiles.error} />
            {profiles.isLoading && <span className="text-ink-muted">加载中…</span>}
            {refs.map((p) => {
              const additions = [...Object.values(p.base?.kernels ?? {}), ...Object.values(p.base?.clients ?? {})].filter(Boolean).length;
              return (
                <div key={p.id} className="flex justify-between gap-2 border-t border-line-2 py-2.5 text-[13px] first:border-0 first:pt-0">
                  <Link to={`/profiles/${p.id}/base`} className="font-medium text-ink no-underline hover:text-brand">{p.name}</Link>
                  <span className="text-[12px] whitespace-nowrap text-ink-muted">{additions ? `${additions} 份追加` : '无追加'}</span>
                </div>
              );
            })}
            {profiles.data && !refs.length && <Empty title="还没有配置订阅引用它" />}
          </Card>
        </div>
      </PageScroll>

    </>
  );
}
