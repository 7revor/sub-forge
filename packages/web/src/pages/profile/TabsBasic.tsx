import type { ChainRule } from '@sub-forge/core';
import { ChainRuleEditor, chainForLanding } from './ChainRuleEditor.tsx';
import { nodeSetKey, putChain } from './memberModel.ts';
import { targetLabel } from '../../components/pickers.tsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog.tsx';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogFooter, AlertDialogDescription, AlertDialogCancel } from '../../components/ui/alert-dialog.tsx';
import { YamlTextarea } from '../../components/YamlTextarea.tsx';
import { formatRelativeTime } from '../../utils/format.ts';
import { accessLogOptions, tokenOptions } from '../../hooks/documentQueries.ts';
import { Notice } from '../../components/Notice.tsx';
import { NODE_SET_LABEL } from '../../domain/nodeSet.ts';
import { NodeSetCount } from '../../components/NodeSetCount.tsx';
import { CopyButton } from '../../components/CopyButton.tsx';
// Profile 标签：概览（订阅链接、输出设置、访问日志）、基础设置、节点集。

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api, type TokenItem } from '../../api.ts';
import { DeleteDialog } from '../../components/DetailActions.tsx';
import { NodeSetPickerDialog } from '../../components/dialogs.tsx';
import { Badge, Button, Card, Empty, ErrorAlert, Field, Input, Segmented, Select, formatTime, td, th, cx } from '../../components/ui.tsx';
import { useList } from '../../hooks.ts';
import { DualEditor } from '../../components/DualEditor.tsx';
import { OverrideForm } from '../../components/OverrideField.tsx';
import { SchemaForm } from '../../components/SchemaForm.tsx';
import { baseFormFromYaml, baseFromYaml, baseToYaml } from '../../convert/baseYaml.ts';
import { baseFromForm, baseToForm, mihomoBaseGroups } from '../../schemas/mihomoBase.ts';
import { stashBaseGroups } from '../../schemas/stashBase.ts';
import { useProfile } from './context.ts';

const SOURCE_TEXT: Record<string, string> = { fresh: '未命中', cache: '命中', 'last-good': '上次成功结果', failed: '失败', unsupported: '不支持' };

/** 概览（设计稿「Profile · 概览」）：订阅链接、输出设置、访问日志 */
export function TabOverview() {
  const { draft, setDraft, allNodeSets } = useProfile();
  const qc = useQueryClient();
  const tokens = useQuery(tokenOptions(draft.id));
  const log = useQuery(accessLogOptions(draft.id));
  const refreshTokens = () => qc.invalidateQueries({ queryKey: ['tokens', draft.id] });
  const [label, setLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<TokenItem>();
  const [deleting, setDeleting] = useState<TokenItem>();
  const create = useMutation({ meta: { successMessage: '订阅链接已创建' }, mutationFn: () => api('POST', `/profiles/${draft.id}/tokens`, label ? { label } : {}), onSuccess: () => { setLabel(''); setAdding(false); void refreshTokens(); } });
  const reset = useMutation({ meta: { successMessage: '订阅链接已重置' }, mutationFn: (t: string) => api('POST', `/profiles/${draft.id}/tokens/${t}/reset`), onSuccess: () => { setResetting(undefined); void refreshTokens(); } });
  const remove = useMutation({ meta: { successMessage: '订阅链接已删除' }, mutationFn: (t: string) => api('DELETE', `/profiles/${draft.id}/tokens/${t}`), onSuccess: () => { setDeleting(undefined); void refreshTokens(); } });
  const userinfo = draft.userinfo ?? { mode: 'sum' as const };
  const sources = allNodeSets.filter((n) => n.ref.type === 'source' && draft.nodeSets.some((p) => p.ref.type === 'source' && p.ref.id === n.ref.id));
  const rows = log.data ?? [];
  const lastSeen = (token: string) => rows.find((r) => r.token === token)?.at;
  const linkName = (token: string) => tokens.data?.find((t) => t.token === token)?.label ?? '已删除的链接';
  const lastGood = rows.find((r) => r.status === 200 && (r.source === 'fresh' || r.source === 'cache'));

  return (
    <>
      <div className="grid grid-cols-1 gap-5">
        <Card className="min-w-0"
          title={`订阅链接`}
          actions={<Button onClick={() => setAdding(true)}><Plus size={15} />新增链接</Button>}>
          <ErrorAlert error={reset.error ?? remove.error} />
          {!tokens.data?.length ? <Empty title="还没有订阅链接" /> : (
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {tokens.data.map((t) => {
                const seen = lastSeen(t.token);
                return (
                  <li key={t.token} className="flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-lg border border-line px-3.5 py-3">
                    <div className="flex flex-[1_1_160px] flex-col gap-0.5">
                      <span className="text-[13.5px] font-semibold">{t.label || '未命名设备'}</span>
                      <span className="text-[12px] text-ink-muted">{seen ? `最近访问 ${formatRelativeTime(seen)}` : '从未访问'}</span>
                    </div>
                    <code className="min-w-0 flex-[999_1_280px] truncate rounded-md bg-ground px-2.5 py-2 font-mono text-[12.5px]">{t.url}</code>
                    <div className="flex gap-1.5">
                      <CopyButton className="h-9" text={t.url}><Copy size={13} />复制</CopyButton>
                      <CopyButton className="h-9" text={`${t.url}?target=stash&platform=ios`}>复制 Stash 链接</CopyButton>
                      <Button className="h-9 text-err" onClick={() => setResetting(t)}><RotateCcw size={13} />重置 token</Button>
                      <Button variant="ghost" className="h-9 w-9 px-0" aria-label={`删除链接 ${t.label || ''}`} onClick={() => { remove.reset(); setDeleting(t); }}><Trash2 size={14} /></Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
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
            <Field label="客户端中的显示名">{(id) => <Input placeholder="填写配置订阅的名称" id={id} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />}</Field>
            {lastGood
              ? <div className="rounded-lg bg-ok-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-[#17633a]">最近一次成功渲染：{formatRelativeTime(lastGood.at)}（{lastGood.client}）</div>
              : <Empty title="还没有成功渲染过" />}
          </div>
        </Card>
      </div>
      <Card title="访问日志" actions={<span className="text-[12.5px] text-ink-muted">保留 30 天</span>} bodyClass="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse">
          <thead><tr><th className={th}>时间</th><th className={th}>链接</th><th className={th}>识别结果</th><th className={th}>User-Agent</th><th className={th}>耗时</th><th className={th}>缓存</th><th className={th}>告警</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className={cx(td, 'font-mono text-[12.5px] whitespace-nowrap')}>{formatTime(r.at).slice(5)}</td>
                <td className={td}>{linkName(r.token)}</td>
                <td className={cx(td, 'font-medium')}>{r.client}{r.platform ? ` · ${r.platform}` : ''}{r.status !== 200 && <Badge tone="err" className="ml-2">{r.status}</Badge>}</td>
                <td className={cx(td, 'max-w-[280px] truncate font-mono text-[12px] text-ink-muted')}>{r.ua}</td>
                <td className={cx(td, 'font-mono text-[12.5px] whitespace-nowrap')}>{r.ms >= 1000 ? `${(r.ms / 1000).toFixed(2)} s` : `${r.ms} ms`}</td>
                <td className={td}>{SOURCE_TEXT[r.source] ?? r.source}</td>
                <td className={td}><Badge tone={r.warnings ? 'warn' : 'neutral'}>{r.warnings}</Badge></td>
              </tr>
            ))}
            {!rows.length && <tr><td className={td} colSpan={7}><Empty title="还没有访问记录" /></td></tr>}
          </tbody>
        </table>
      </Card>
      <DeleteDialog title={`删除订阅链接「${deleting?.label || '未命名设备'}」？`} open={!!deleting} pending={remove.isPending} error={remove.error}
        onClose={() => setDeleting(undefined)} onConfirm={() => { if (deleting) remove.mutate(deleting.token); }}>
        使用它的设备将无法更新。
      </DeleteDialog>
      <Dialog open={adding} onOpenChange={next => { if (!next) (() => setAdding(false))(); }}><DialogContent className="max-h-[85dvh] overflow-y-auto" aria-describedby={undefined}><DialogHeader><DialogTitle>{"新增订阅链接"}</DialogTitle></DialogHeader><div className="flex min-h-0 flex-col gap-3.5">
        <Field label="设备备注">{(id) => <Input placeholder="填写订阅链接的标识名称" id={id} autoFocus value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') create.mutate(); }} />}</Field>
        <ErrorAlert error={create.error} />
      </div><DialogFooter>{<><Button onClick={() => setAdding(false)}>取消</Button><Button variant="primary" disabled={create.isPending} onClick={() => create.mutate()}>{create.isPending ? '创建中…' : '创建链接'}</Button></>}</DialogFooter></DialogContent></Dialog>
      <AlertDialog open={!!resetting} onOpenChange={next => { if (!next) (() => setResetting(undefined))(); }}><AlertDialogContent className="max-h-[85dvh] overflow-y-auto"><AlertDialogHeader><AlertDialogTitle>{`重置「${resetting?.label || '未命名设备'}」的 token？`}</AlertDialogTitle></AlertDialogHeader><AlertDialogDescription asChild><div className="flex flex-col gap-3.5">
        <span className="text-[13.5px] leading-relaxed">旧链接立即失效，这台设备需要导入新链接才能继续更新。</span>
      </div></AlertDialogDescription><AlertDialogFooter>{<><AlertDialogCancel>取消</AlertDialogCancel><Button className="border-err bg-err text-white hover:bg-[#912018]" disabled={reset.isPending} onClick={() => resetting && reset.mutate(resetting.token)}>{reset.isPending ? '重置中…' : '重置'}</Button></>}</AlertDialogFooter></AlertDialogContent></AlertDialog>
    </>
  );
}

/** 基础设置（设计稿「Profile · 基础设置」）：来源条、进程规则提醒、按客户端分区的覆盖项、原样片段 */
export function TabBase() {
  const { draft, setDraft, baseValid, setBaseValid, baseEditorKey, template } = useProfile();
  const presets = useList('presets').data ?? [];
  const [client, setClient] = useState<'mihomo' | 'surge' | 'stash'>('mihomo');
  const preset = presets.find((p) => p.id === draft.base?.presetId);
  const mode = draft.base === undefined ? 'none' : draft.base.presetId !== undefined ? 'preset' : 'custom';
  const patch = (client === 'stash' ? draft.base?.stashPatch : draft.base?.patch) ?? {};
  const inherited = (client === 'stash' ? preset?.stash : preset?.mihomo) ?? {};
  const groups = client === 'stash' ? stashBaseGroups : mihomoBaseGroups;
  const changePatch = (patch: Record<string, unknown>) => setDraft({ ...draft, base: { ...draft.base, [client === 'stash' ? 'stashPatch' : 'patch']: patch } });
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
              else if (m === 'custom') setDraft({ ...draft, base: { patch: draft.base?.patch ?? {}, stashPatch: draft.base?.stashPatch ?? {}, ...(draft.base?.raw ? { raw: draft.base.raw } : {}) } });
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
            <Segmented label="客户端" value={client} options={[{ value: 'mihomo', label: 'mihomo' }, { value: 'surge', label: 'Surge' }, { value: 'stash', label: 'Stash' }]} onChange={setClient} />
            {client === 'surge' ? (
              <Empty title="Surge 基础设置暂未开放" />
            ) : (
              <DualEditor key={`${draft.id}:${client}:${mode}:${draft.base?.presetId ?? ''}:${baseEditorKey}`} value={patch} onChange={changePatch} onValidityChange={setBaseValid}
                toRaw={baseToYaml} fromRaw={baseFromYaml} recoverForm={(text) => baseFormFromYaml(text, groups)} rawLabel={mode === 'preset' ? '覆盖项 YAML' : `${client === 'stash' ? 'Stash' : 'mihomo'} YAML`}
                renderForm={() => mode === 'preset'
                  ? <OverrideForm groups={groups} base={baseToForm(inherited)} patch={baseToForm(patch)}
                      onChange={(value) => changePatch(baseFromForm(value, patch, inherited))} />
                  : <div className="rounded-[10px] border border-line bg-panel px-4.5 pb-4"><SchemaForm groups={groups} value={baseToForm(patch)} extra
                      onChange={(value) => changePatch(baseFromForm(value, patch))} /></div>} />
            )}
          </div>
          {client !== 'stash' && <section className="flex min-w-0 flex-[1_1_320px] flex-col gap-2.5 rounded-[10px] border border-line bg-panel px-4.5 py-4">
            <div className="flex items-center justify-between"><h2 className="m-0 text-[14px] font-semibold">原样片段</h2></div>
            <label htmlFor="raw-snippet" className="text-[12.5px] text-ink-muted">{client === 'mihomo' ? 'YAML' : 'INI'}</label>
            <YamlTextarea id="raw-snippet" rows={10} className="bg-[#fafbfc] font-mono text-[12.5px] leading-relaxed" spellCheck={false}
              disabled={client === 'surge'} placeholder={client === 'mihomo' ? '填写要合并到基础配置的 YAML 字段，如 hosts 域名映射' : '暂未开放'}
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
  const { draft, setDraft, allNodeSets, nodeSetName, groupName } = useProfile();
  const [adding, setAdding] = useState(false);
  const [editingChain, setEditingChain] = useState<ChainRule>();
  const chained = new Set(draft.chains.map((c) => `${c.landing.nodeSet.type}:${c.landing.nodeSet.id}`));

  return (
    <>
      <Card title="节点来源" subtitle="加入节点集后，在下方策略组中填充。"
        actions={<Button onClick={() => setAdding(true)}><Plus size={15} />添加节点集</Button>} bodyClass="pb-1">
        {!draft.nodeSets.length ? <div className="px-4 pb-4"><Empty title="还没有节点集" /></div> : <ul className="m-0 list-none p-0">
          {draft.nodeSets.map((n, i) => <li key={`${n.ref.type}:${n.ref.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-line-2 px-4 py-3">
            <div className="flex min-w-0 flex-[1_1_180px] flex-col gap-1"><span className="truncate text-[13.5px] font-medium">{nodeSetName(n.ref)}</span>
              <span className="text-[12px] text-ink-muted">{NODE_SET_LABEL[n.ref.type]} · <NodeSetCount nodeSet={n.ref} /> 个节点{chained.has(`${n.ref.type}:${n.ref.id}`) && ' · 已配置代理链'}</span>
            </div>
            <Segmented label={`${nodeSetName(n.ref)}输出方式`} size="sm" value={n.output} options={[{ value: 'provider', label: 'Provider' }, { value: 'inline', label: 'Inline' }]} onChange={output => setDraft({ ...draft, nodeSets: draft.nodeSets.map((x, j) => j === i ? { ...x, output } : x) })} />
            <Button size="sm" onClick={() => setEditingChain(chainForLanding(draft.chains, { nodeSet: n.ref }))}>{(() => { const c = draft.chains.find(c => nodeSetKey(c.landing.nodeSet) === nodeSetKey(n.ref) && !c.landing.filter && !c.landing.excludeFilter); return c ? `整集前置：${targetLabel(c.via, groupName, nodeSetName)}` : '设置整集前置'; })()}</Button>
            <Button size="sm" variant="ghost" className="w-8 px-0" aria-label={`移除 ${nodeSetName(n.ref)}`} onClick={() => setDraft({ ...draft, nodeSets: draft.nodeSets.filter((_, j) => j !== i) })}><Trash2 size={14} /></Button>
          </li>)}
        </ul>}
      </Card>
      <Dialog open={!!editingChain} onOpenChange={open => { if (!open) setEditingChain(undefined); }}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl" aria-describedby={undefined}><DialogHeader><DialogTitle>节点集前置</DialogTitle></DialogHeader>{editingChain && <ChainRuleEditor key={editingChain.id} initial={editingChain} fixedLanding onCancel={() => setEditingChain(undefined)} onApply={chain => { setDraft({ ...draft, chains: putChain(draft.chains, chain) }); setEditingChain(undefined); }} onRemove={draft.chains.some(c => c.id === editingChain.id) ? () => { setDraft({ ...draft, chains: draft.chains.filter(c => c.id !== editingChain.id) }); setEditingChain(undefined); } : undefined} />}</DialogContent></Dialog>
      <NodeSetPickerDialog open={adding} options={allNodeSets} added={draft.nodeSets.map((n) => n.ref)} onClose={() => setAdding(false)}
        onAdd={(refs) => setDraft({ ...draft, nodeSets: [...draft.nodeSets, ...refs.map((ref) => ({ ref, output: 'provider' as const }))] })} />
    </>
  );
}
