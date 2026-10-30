import { BaseExtract } from '../../components/BaseExtract.tsx';
import { RoutingCard, RoutingCardIcon } from '../../components/RoutingCard.tsx';
import { SortableList } from '../../components/SortableList.tsx';
import { appendProviderGroup } from './providerGroup.ts';
import type { NodeSetID } from '@sub-forge/core';
import { chainUsesNodeSet, landingNodeName, removeProfileNodeSet } from './chainModel.ts';
import { Frame } from '../../modals/Frame.tsx';
import { YamlTextarea } from '../../components/YamlTextarea.tsx';
import { formatRelativeTime } from '../../utils/format.ts';
import { accessLogOptions } from '../../hooks/documentQueries.ts';
import { Notice } from '../../components/Notice.tsx';
import { NODE_SET_LABEL } from '../../domain/nodeSet.ts';
import { NodeSetPreviewModal } from '../../components/NodeSetPreviewModal.tsx';
import { NodeSetCount } from '../../components/NodeSetCount.tsx';
// Profile 标签：概览（输出设置、访问日志）、基础设置、节点集。

import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Trash2, Boxes, ListPlus } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api.ts';
import { NodeSetPickerDialog } from '../../components/dialogs.tsx';
import { Badge, Button, Card, Empty, ErrorAlert, Field, Input, Segmented, Select, formatTime, td, th, cx } from '../../components/ui.tsx';
import { useList } from '../../hooks.ts';
import { DualEditor } from '../../components/DualEditor.tsx';
import { OverrideForm } from '../../components/OverrideField.tsx';
import { SchemaForm } from '../../components/SchemaForm.tsx';
import { baseEditorFor, basePatchKey } from '../../convert/baseClient.ts';
import { baseFromForm, baseToForm } from '../../schemas/mihomoBase.ts';
import { useProfile } from './context.ts';

const SOURCE_TEXT: Record<string, string> = { fresh: '未命中', cache: '命中', 'last-good': '上次成功结果', failed: '失败', unsupported: '不支持' };

/** 概览（设计稿「Profile · 概览」）：输出设置、访问日志 */
export function TabOverview() {
  const { draft, setDraft, allNodeSets } = useProfile();
  const log = useQuery(accessLogOptions(draft.id));
  const userinfo = draft.userinfo ?? { mode: 'sum' as const };
  const sources = allNodeSets.filter((n) => n.ref.type === 'source' && draft.nodeSets.some((p) => p.ref.type === 'source' && p.ref.id === n.ref.id));
  const rows = log.data ?? [];
  const lastGood = rows.find((r) => r.status === 200 && (r.source === 'fresh' || r.source === 'cache'));

  return (
    <>
      <div className="grid grid-cols-1 gap-5">
        <Card title="输出设置" className="min-w-0">
          <div className="flex flex-col gap-3.5">
            <p className="text-[13px] text-muted">更新间隔由管理员在系统中统一设置。</p>
            <Field label="流量 / 到期信息">{(id) => (
              <Select placeholder="选择订阅流量与到期信息的来源" id={id} value={userinfo.mode === 'source' ? `source:${userinfo.sourceId}` : userinfo.mode} onChange={(e) => {
                const v = e.target.value;
                setDraft({ ...draft, userinfo: v.startsWith('source:') ? { mode: 'source', sourceId: v.slice(7) } : { mode: v as 'sum' | 'none' } });
              }}>
                <option value="sum">汇总全部订阅源</option>
                {sources.map((s) => <option key={s.ref.id} value={`source:${s.ref.id}`}>取「{s.name}」</option>)}
                <option value="none">不输出</option>
              </Select>
            )}</Field>
            {lastGood
              ? <div className="rounded-lg bg-ok-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-[#17633a]">最近一次成功渲染：{formatRelativeTime(lastGood.at)}（{lastGood.client}）</div>
              : <Empty title="还没有成功渲染过" />}
          </div>
        </Card>
      </div>
      <Card title="访问日志" actions={<span className="text-[12.5px] text-ink-muted">保留 30 天</span>} bodyClass="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse">
          <thead><tr><th className={th}>时间</th><th className={th}>识别结果</th><th className={th}>User-Agent</th><th className={th}>耗时</th><th className={th}>缓存</th><th className={th}>告警</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className={cx(td, 'font-mono text-[12.5px] whitespace-nowrap')}>{formatTime(r.at).slice(5)}</td>
                <td className={cx(td, 'font-medium')}>{r.client}{r.platform ? ` · ${r.platform}` : ''}{r.status !== 200 && <Badge tone="err" className="ml-2">{r.status}</Badge>}</td>
                <td className={cx(td, 'max-w-[280px] truncate font-mono text-[12px] text-ink-muted')}>{r.ua}</td>
                <td className={cx(td, 'font-mono text-[12.5px] whitespace-nowrap')}>{r.ms >= 1000 ? `${(r.ms / 1000).toFixed(2)} s` : `${r.ms} ms`}</td>
                <td className={td}>{SOURCE_TEXT[r.source] ?? r.source}</td>
                <td className={td}><Badge tone={r.warnings ? 'warn' : 'neutral'}>{r.warnings}</Badge></td>
              </tr>
            ))}
            {!rows.length && <tr><td className={td} colSpan={6}><Empty title="还没有访问记录" /></td></tr>}
          </tbody>
        </table>
      </Card>

    </>
  );
}

/** 基础设置（设计稿「Profile · 基础设置」）：来源条、进程规则提醒、按客户端分区的覆盖项、原样片段 */
export function TabBase() {
  const { draft, setDraft, baseValid, setBaseValid, baseEditorKey, template } = useProfile();
  const presets = useList('presets').data ?? [];
  const [client, setClient] = useState<'common' | 'mihomo' | 'surge' | 'stash' | 'loon'>('common');
  const preset = presets.find((p) => p.id === draft.base?.presetId);
  const mode = draft.base === undefined ? 'none' : draft.base.presetId !== undefined ? 'preset' : 'custom';
  const patch: Record<string, unknown> = draft.base?.[basePatchKey(client)] ?? {};
  const inherited = preset?.[client] ?? {};
  const editor = baseEditorFor(client);
  const groups = editor.groups;
  const changePatch = (patch: Record<string, unknown>) => setDraft({ ...draft, base: { ...draft.base, [basePatchKey(client)]: patch } });
  // 规则里有进程规则，但 find-process-mode 为 off 时进程规则不会生效
  const processMode = (patch['find-process-mode'] ?? preset?.mihomo['find-process-mode']) as string | undefined;
  const hasProcess = JSON.stringify([template?.rules ?? [], draft.overlay.extraRules ?? []]).includes('"PROCESS"');

  return (
    <>
      <section className="flex flex-wrap items-center gap-x-7 gap-y-4 rounded-[10px] border border-line bg-panel px-4.5 py-4">
        <fieldset disabled={!baseValid} className="m-0 flex min-w-0 flex-[1_1_260px] flex-col gap-1.5 border-0 p-0">
          <span className="text-[12.5px] font-medium text-ink-muted">来源</span>
          <Segmented label="基础设置来源" value={mode} options={[{ value: 'preset', label: '引用预设' }, { value: 'custom', label: '完全自定义' }, { value: 'none', label: '不输出' }]}
            onChange={(m) => {
              if (m === 'none') { const { base: _b, ...rest } = draft; setDraft(rest); }
              else if (m === 'custom') setDraft({ ...draft, base: { common: draft.base?.common, patch: draft.base?.patch ?? {}, stashPatch: draft.base?.stashPatch ?? {}, surgePatch: draft.base?.surgePatch ?? {}, loonPatch: draft.base?.loonPatch ?? {}, ...(draft.base?.raw ? { raw: draft.base.raw } : {}) } });
              else setDraft({ ...draft, base: { ...(draft.base ?? {}), presetId: presets[0]?.id ?? '' } });
            }} />
        </fieldset>
        {mode === 'preset' && <Field label="预设" className="flex-[1_1_260px]">{(id) => (
          <Select placeholder="选择要继承的基础设置预设" id={id} className="h-10" disabled={!baseValid} value={draft.base?.presetId ?? ''} onChange={(e) => setDraft({ ...draft, base: { ...draft.base, presetId: e.target.value } })}>
            {presets.map((p) => <option key={p.id} value={p.id}>{p.name}（v{p.version}）</option>)}
          </Select>
        )}</Field>}
      </section>

      {client === 'mihomo' && hasProcess && processMode !== undefined && processMode !== 'strict' && processMode !== 'always' && mode !== 'none' && (
        <Notice tone="warn" actions={<Button className="h-9 border-[#e2b88a] bg-[#fff8f0]" onClick={() => changePatch({ ...patch, 'find-process-mode': 'strict' })}>改为 strict</Button>}><span className="text-[13px] leading-normal"><b>进程规则不会生效：</b>规则里有进程规则，但 <span className="font-mono">find-process-mode</span> 当前为 <span className="font-mono">{processMode}</span>。</span></Notice>
      )}

      {mode !== 'none' && (
        <div className="flex flex-wrap items-start gap-5">
          <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
            <Segmented label="客户端" value={client} options={[{ value: 'common', label: '公共项' }, { value: 'mihomo', label: 'mihomo' }, { value: 'surge', label: 'Surge' }, { value: 'loon', label: 'Loon' }, { value: 'stash', label: 'Stash' }]} onChange={setClient} />
            <p className="text-[13px] text-ink-muted">合并顺序：预设公共项 → 本订阅公共项 → 预设客户端覆盖 → 本订阅客户端覆盖。</p>
            {client !== 'common' && <BaseExtract client={client} value={patch} common={draft.base?.common} disabled={!baseValid} onApply={(common, native) => setDraft({ ...draft, base: { ...draft.base, common, [basePatchKey(client)]: native } })} />}
            {(
              <DualEditor key={`${draft.id}:${client}:${mode}:${draft.base?.presetId ?? ''}:${baseEditorKey}`} value={patch} onChange={changePatch} onValidityChange={setBaseValid}
                toRaw={editor.toRaw} fromRaw={editor.fromRaw} recoverForm={(text) => editor.recoverForm(text, patch)} rawLabel={`${mode === 'preset' ? '覆盖项' : client} ${editor.format}`}
                renderForm={() => mode === 'preset'
                  ? <OverrideForm groups={groups} base={baseToForm(inherited)} patch={baseToForm(patch)}
                      onChange={(value) => changePatch(baseFromForm(value, patch, inherited))} />
                  : <div className="rounded-[10px] border border-line bg-panel px-4.5 pb-4"><SchemaForm groups={groups} value={baseToForm(patch)} extra
                      onChange={(value) => changePatch(baseFromForm(value, patch))} /></div>} />
            )}
          </div>
          {client === 'mihomo' && <section className="flex min-w-0 flex-[1_1_320px] flex-col gap-2.5 rounded-[10px] border border-line bg-panel px-4.5 py-4">
            <div className="flex items-center justify-between"><h2 className="m-0 text-[14px] font-semibold">原样片段</h2></div>
            <label htmlFor="raw-snippet" className="text-[12.5px] text-ink-muted">{client === 'mihomo' ? 'YAML' : 'INI'}</label>
            <YamlTextarea id="raw-snippet" rows={10} className="bg-[#fafbfc] font-mono text-[12.5px] leading-relaxed" spellCheck={false}
              placeholder={client === 'mihomo' ? '填写要合并到基础配置的 YAML 字段，如 hosts 域名映射' : '暂未开放'}
              value={client === 'mihomo' ? draft.base?.raw ?? '' : ''} onChange={(e) => setDraft({ ...draft, base: { ...draft.base, raw: e.target.value || undefined } })} />
            <span className="text-[12px] leading-normal text-ink-muted">原样片段暂不输出。</span>
          </section>}
        </div>
      )}
    </>
  );
}


/** 节点集（设计稿「Profile · 节点集」）：表格 + 添加对话框，下方说明两种输出方式 */
export function TabNodeSets() {
  const { draft, setDraft, allNodeSets, nodeSetName, groupName, groups } = useProfile();
  const remove = async (ref: NodeSetID) => {
    const affected = draft.chains.filter(c => chainUsesNodeSet(c, ref));
    if (affected.length) {
      const chains = affected.map(c => `${c.via.kind === 'group' ? groupName(c.via.groupId) : c.via.kind === 'builtin' ? c.via.name : 'exact' in c.via.ref.match ? c.via.ref.match.exact : '筛选节点'} → ${landingNodeName(c.landing) ?? (c.landing.filter || c.landing.excludeFilter ? '筛选节点' : '全部节点')}`).join('\n');
      const result = await Frame.modal.confirm({ title: `移出节点集「${nodeSetName(ref)}」？`, description: `以下 ${affected.length} 条代理链引用了此节点集，将一起移除。保存订阅后生效。\n\n${chains}`, confirmLabel: '移出并移除代理链', danger: true });
      if (result.status !== 'confirmed') return;
    }
    setDraft(removeProfileNodeSet(draft, ref));
  };
  return (
    <>
      <Card title="节点来源" subtitle={`${draft.nodeSets.length} 个`}
        actions={<Button size="sm" onClick={async () => { const result = await NodeSetPickerDialog.show({ options: allNodeSets, added: draft.nodeSets.map(n => n.ref) }); if (result.status === 'confirmed') setDraft({ ...draft, nodeSets: [...draft.nodeSets, ...result.data.map(ref => ({ ref, output: 'provider' as const }))] }); }}><Plus size={14} />添加节点集</Button>}>
        {!draft.nodeSets.length ? <Empty title="还没有节点集" /> : <SortableList items={draft.nodeSets} getKey={n => `${n.ref.type}:${n.ref.id}`} onReorder={nodeSets => setDraft({ ...draft, nodeSets })} renderItem={(n, i, handle) => <RoutingCard className="grid grid-cols-[24px_32px_minmax(0,1fr)_68px] md:grid-cols-[24px_32px_minmax(0,1fr)_minmax(0,1fr)_140px_68px]">
          {handle}<RoutingCardIcon><Boxes size={16} /></RoutingCardIcon>
          <button type="button" aria-label={`预览 ${nodeSetName(n.ref)} 的节点`} onClick={() => void NodeSetPreviewModal.show({ nodeSet: n.ref, name: nodeSetName(n.ref) })} className="min-w-0 cursor-pointer truncate rounded text-left font-medium hover:text-brand hover:underline focus-visible:outline-brand">{nodeSetName(n.ref)}</button>
          <span className="col-start-3 row-start-2 min-w-0 truncate text-ink-2 md:col-auto md:row-auto">{NODE_SET_LABEL[n.ref.type]} · <NodeSetCount nodeSet={n.ref} /> 个节点</span>
          <div className="col-span-2 col-start-3 row-start-3 w-[140px] md:col-auto md:row-auto [&>div]:w-full [&_button]:flex-1 [&_button]:px-0"><Segmented label={`${nodeSetName(n.ref)}输出方式`} size="sm" value={n.output} options={[{ value: 'provider', label: 'Provider' }, { value: 'inline', label: 'Inline' }]} onChange={output => setDraft({ ...draft, nodeSets: draft.nodeSets.map((x, j) => j === i ? { ...x, output } : x) })} /></div>
          <div className="col-start-4 row-start-1 grid w-[68px] grid-cols-2 gap-1 md:col-auto md:row-auto">
            {n.output === 'provider' ? <Button size="sm" variant="ghost" className="w-8 px-0" aria-label={`为 ${nodeSetName(n.ref)} 追加独立策略组`} title="追加独立策略组" onClick={() => setDraft(appendProviderGroup(draft, n.ref, nodeSetName(n.ref), groups))}><ListPlus size={14} /></Button> : <span aria-hidden="true" className="size-8" />}
            <Button size="sm" variant="ghost" className="w-8 px-0" aria-label={`移除 ${nodeSetName(n.ref)}`} title="移除节点来源" onClick={() => void remove(n.ref)}><Trash2 size={14} /></Button>
          </div>
        </RoutingCard>} />}
      </Card>

    </>
  );
}
