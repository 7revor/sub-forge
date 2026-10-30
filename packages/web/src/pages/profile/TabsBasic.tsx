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
import { Badge, Button, Card, Empty, ErrorAlert, Field, Input, Modal, Segmented, Select, formatTime, td, th, cx } from '../../components/ui.tsx';
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
                      <span className="text-[12px] text-muted">{seen ? `最近访问 ${formatRelativeTime(seen)}` : '从未访问'}</span>
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
            <Field label="更新间隔">{(id) => (
              <Select id={id} value={String(draft.updateIntervalSec ?? 86400)} onChange={(e) => setDraft({ ...draft, updateIntervalSec: Number(e.target.value) })}>
                {[[86400, '24 小时'], [43200, '12 小时'], [21600, '6 小时'], [3600, '1 小时']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            )}</Field>
            <Field label="流量 / 到期信息">{(id) => (
              <Select id={id} value={userinfo.mode === 'source' ? `source:${userinfo.sourceId}` : userinfo.mode} onChange={(e) => {
                const v = e.target.value;
                setDraft({ ...draft, userinfo: v.startsWith('source:') ? { mode: 'source', sourceId: v.slice(7) } : { mode: v as 'sum' | 'none' } });
              }}>
                <option value="sum">汇总全部订阅源</option>
                {sources.map((s) => <option key={s.ref.id} value={`source:${s.ref.id}`}>取「{s.name}」</option>)}
                <option value="none">不输出</option>
              </Select>
            )}</Field>
            <Field label="客户端中的显示名">{(id) => <Input id={id} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />}</Field>
            {lastGood
              ? <div className="rounded-lg bg-ok-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-[#17633a]">最近一次成功渲染：{formatRelativeTime(lastGood.at)}（{lastGood.client}）</div>
              : <Empty title="还没有成功渲染过" />}
          </div>
        </Card>
      </div>
      <Card title="访问日志" actions={<span className="text-[12.5px] text-muted">保留 30 天</span>} bodyClass="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse">
          <thead><tr><th className={th}>时间</th><th className={th}>链接</th><th className={th}>识别结果</th><th className={th}>User-Agent</th><th className={th}>耗时</th><th className={th}>缓存</th><th className={th}>告警</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className={cx(td, 'font-mono text-[12.5px] whitespace-nowrap')}>{formatTime(r.at).slice(5)}</td>
                <td className={td}>{linkName(r.token)}</td>
                <td className={cx(td, 'font-medium')}>{r.client}{r.platform ? ` · ${r.platform}` : ''}{r.status !== 200 && <Badge tone="err" className="ml-2">{r.status}</Badge>}</td>
                <td className={cx(td, 'max-w-[280px] truncate font-mono text-[12px] text-muted')}>{r.ua}</td>
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
      <Modal title="新增订阅链接" open={adding} onClose={() => setAdding(false)}
        footer={<><Button onClick={() => setAdding(false)}>取消</Button><Button variant="primary" disabled={create.isPending} onClick={() => create.mutate()}>{create.isPending ? '创建中…' : '创建链接'}</Button></>}>
        <Field label="设备备注">{(id) => <Input id={id} autoFocus value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') create.mutate(); }} />}</Field>
        <ErrorAlert error={create.error} />
      </Modal>
      <Modal alert title={`重置「${resetting?.label || '未命名设备'}」的 token？`} open={!!resetting} onClose={() => setResetting(undefined)}
        footer={<><Button onClick={() => setResetting(undefined)}>取消</Button><Button className="border-err bg-err text-white hover:bg-[#912018]" disabled={reset.isPending} onClick={() => resetting && reset.mutate(resetting.token)}>{reset.isPending ? '重置中…' : '重置'}</Button></>}>
        <span className="text-[13.5px] leading-relaxed">旧链接立即失效，这台设备需要导入新链接才能继续更新。</span>
      </Modal>
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
          <span className="text-[12.5px] font-medium text-muted">来源</span>
          <Segmented label="基础设置来源" value={mode} options={[{ value: 'preset', label: '引用预设' }, { value: 'custom', label: '完全自定义' }, { value: 'none', label: '不输出' }]}
            onChange={(m) => {
              if (m === 'none') { const { base: _b, ...rest } = draft; setDraft(rest); }
              else if (m === 'custom') setDraft({ ...draft, base: { patch: draft.base?.patch ?? {}, stashPatch: draft.base?.stashPatch ?? {}, ...(draft.base?.raw ? { raw: draft.base.raw } : {}) } });
              else setDraft({ ...draft, base: { ...(draft.base ?? {}), presetId: presets[0]?.id ?? '' } });
            }} />
        </fieldset>
        {mode === 'preset' && <Field label="预设" className="flex-[1_1_260px]">{(id) => (
          <Select id={id} className="h-10" disabled={!baseValid} value={draft.base?.presetId ?? ''} onChange={(e) => setDraft({ ...draft, base: { ...draft.base, presetId: e.target.value } })}>
            <option value="" disabled>选择预设</option>
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
            <label htmlFor="raw-snippet" className="text-[12.5px] text-muted">{client === 'mihomo' ? 'YAML' : 'INI'}</label>
            <YamlTextarea id="raw-snippet" rows={10} className="bg-[#fafbfc] font-mono text-[12.5px] leading-relaxed" spellCheck={false}
              disabled={client === 'surge'} placeholder={client === 'mihomo' ? 'hosts:\n  router.home: 192.168.1.1' : '暂未开放'}
              value={client === 'mihomo' ? draft.base?.raw ?? '' : ''} onChange={(e) => setDraft({ ...draft, base: { ...draft.base, raw: e.target.value || undefined } })} />
            <span className="text-[12px] leading-normal text-muted">原样片段暂不输出。</span>
          </section>}
        </div>
      )}
    </>
  );
}


/** 节点集（设计稿「Profile · 节点集」）：表格 + 添加对话框，下方说明两种输出方式 */
export function TabNodeSets() {
  const { draft, setDraft, allNodeSets, nodeSetName } = useProfile();
  const [adding, setAdding] = useState(false);
  const chained = new Set(draft.chains.map((c) => `${c.landing.nodeSet.type}:${c.landing.nodeSet.id}`));

  return (
    <>
      <Card title={`已加入的节点集`}
        actions={<Button onClick={() => setAdding(true)}><Plus size={15} />添加节点集</Button>} bodyClass="overflow-x-auto">
        {!draft.nodeSets.length ? <div className="px-4 pb-4"><Empty title="还没有节点集" /></div> : (
          <table className="w-full min-w-[820px] border-collapse">
            <thead><tr><th className={th}>节点集</th><th className={th}>类型</th><th className={th}>节点</th><th className={th}>输出方式</th><th className={th}>备注</th><th className={cx(th, 'w-px')}><span className="sr-only">操作</span></th></tr></thead>
            <tbody>
              {draft.nodeSets.map((n, i) => (
                <tr key={`${n.ref.type}:${n.ref.id}`}>
                  <td className={cx(td, 'font-medium')}>{nodeSetName(n.ref)}</td>
                  <td className={cx(td, 'text-ink-2')}>{NODE_SET_LABEL[n.ref.type]}</td>
                  <td className={td}><NodeSetCount nodeSet={n.ref} /></td>
                  <td className={td}><Segmented label="输出方式" size="sm" value={n.output} options={[{ value: 'provider', label: 'provider' }, { value: 'inline', label: 'inline' }]} onChange={(output) => setDraft({ ...draft, nodeSets: draft.nodeSets.map((x, j) => (j === i ? { ...x, output } : x)) })} /></td>
                  <td className={cx(td, 'text-[12.5px] text-muted')}>{chained.has(`${n.ref.type}:${n.ref.id}`) ? '有链规则 · Profile 专属 provider' : '—'}</td>
                  <td className={cx(td, 'text-right')}><Button size="sm" variant="ghost" className="w-8 px-0" aria-label={`移除 ${nodeSetName(n.ref)}`} onClick={() => setDraft({ ...draft, nodeSets: draft.nodeSets.filter((_, j) => j !== i) })}><Trash2 size={14} /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <NodeSetPickerDialog open={adding} options={allNodeSets} added={draft.nodeSets.map((n) => n.ref)} onClose={() => setAdding(false)}
        onAdd={(refs) => setDraft({ ...draft, nodeSets: [...draft.nodeSets, ...refs.map((ref) => ({ ref, output: 'provider' as const }))] })} />
    </>
  );
}
