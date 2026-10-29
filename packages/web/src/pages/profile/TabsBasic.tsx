// Profile 标签：概览（订阅链接、输出设置、访问日志）、基础设置、节点集。

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api, type AccessLogRow, type TokenItem } from '../../api.ts';
import { NodeSetSelect } from '../../components/pickers.tsx';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Segmented, Select, formatTime, td, th, cx } from '../../components/ui.tsx';
import { useList } from '../../hooks.ts';
import { DualEditor } from '../../components/DualEditor.tsx';
import { OverrideForm } from '../../components/OverrideField.tsx';
import { SchemaForm } from '../../components/SchemaForm.tsx';
import { baseFormFromYaml, baseFromYaml, baseToYaml } from '../../convert/baseYaml.ts';
import { baseFromForm, baseToForm, mihomoBaseGroups } from '../../schemas/mihomoBase.ts';
import { useProfile } from './context.ts';
import { TemplateCard } from './TemplateCard.tsx';

function copy(text: string) {
  void navigator.clipboard?.writeText(text);
}

export function TabOverview() {
  const { draft, setDraft, allNodeSets } = useProfile();
  const qc = useQueryClient();
  const tokens = useQuery({ queryKey: ['tokens', draft.id], queryFn: () => api<{ items: TokenItem[] }>('GET', `/profiles/${draft.id}/tokens`).then((r) => r.items) });
  const log = useQuery({ queryKey: ['access-log', draft.id], queryFn: () => api<{ items: AccessLogRow[] }>('GET', `/profiles/${draft.id}/access-log`).then((r) => r.items) });
  const refreshTokens = () => qc.invalidateQueries({ queryKey: ['tokens', draft.id] });
  const [label, setLabel] = useState('');
  const create = useMutation({ mutationFn: () => api('POST', `/profiles/${draft.id}/tokens`, label ? { label } : {}), onSuccess: () => { setLabel(''); void refreshTokens(); } });
  const reset = useMutation({ mutationFn: (t: string) => api('POST', `/profiles/${draft.id}/tokens/${t}/reset`), onSuccess: refreshTokens });
  const remove = useMutation({ mutationFn: (t: string) => api('DELETE', `/profiles/${draft.id}/tokens/${t}`), onSuccess: refreshTokens });
  const userinfo = draft.userinfo ?? { mode: 'sum' as const };
  const sources = allNodeSets.filter((n) => n.ref.type === 'source' && draft.nodeSets.some((p) => p.ref.type === 'source' && p.ref.id === n.ref.id));

  return (
    <>
      <TemplateCard />
      <div className="flex flex-wrap items-start gap-5">
        <Card title="订阅链接" className="min-w-0 flex-[999_1_560px]"
          actions={<form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
            <Input aria-label="设备备注" placeholder="设备备注，如 MacBook" value={label} onChange={(e) => setLabel(e.target.value)} className="w-48" />
            <Button type="submit" disabled={create.isPending}><Plus size={15} />新增链接</Button>
          </form>}>
          <p className="mt-0 mb-3 text-[12.5px] text-muted">一个设备一个链接，便于单独重置。按 UA 或 ?target= 自动输出 mihomo（Surge 在 M2）。</p>
          <ErrorBox error={create.error ?? reset.error ?? remove.error} />
          {!tokens.data?.length ? <Empty>还没有订阅链接。</Empty> : (
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {tokens.data.map((t) => (
                <li key={t.token} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-line px-3.5 py-3">
                  <div className="flex flex-[1_1_140px] flex-col gap-0.5">
                    <span className="text-[13.5px] font-semibold">{t.label || '未命名设备'}</span>
                    <span className="text-[12px] text-muted">创建于 {formatTime(t.createdAt)}</span>
                  </div>
                  <code className="min-w-0 flex-[999_1_280px] truncate rounded-md bg-ground px-2.5 py-2 font-mono text-[12.5px]">{t.url}</code>
                  <div className="flex gap-1.5">
                    <Button size="sm" onClick={() => copy(t.url)}><Copy size={13} />复制</Button>
                    <Button size="sm" onClick={() => { if (confirm('重置后旧链接立即失效，确定？')) reset.mutate(t.token); }}><RotateCcw size={13} />重置</Button>
                    <Button size="sm" variant="danger" aria-label="删除链接" onClick={() => { if (confirm('删除这个订阅链接？')) remove.mutate(t.token); }}><Trash2 size={13} /></Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="输出设置" className="min-w-0 flex-[1_1_320px]">
          <div className="flex flex-col gap-3.5">
            <Field label="名称" hint="客户端里显示的订阅名">{(id) => <Input id={id} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />}</Field>
            <Field label="更新间隔" hint="写入 profile-update-interval 响应头">{(id) => (
              <Select id={id} value={String(draft.updateIntervalSec ?? 86400)} onChange={(e) => setDraft({ ...draft, updateIntervalSec: Number(e.target.value) })}>
                {[[3600, '1 小时'], [21600, '6 小时'], [43200, '12 小时'], [86400, '24 小时']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
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
          </div>
        </Card>
      </div>
      <Card title="访问日志" actions={<span className="text-[12.5px] text-muted">保留 30 天</span>} bodyClass="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse">
          <thead><tr><th className={th}>时间</th><th className={th}>识别结果</th><th className={th}>User-Agent</th><th className={th}>状态</th><th className={th}>耗时</th><th className={th}>来源</th><th className={th}>告警</th></tr></thead>
          <tbody>
            {(log.data ?? []).map((r, i) => (
              <tr key={i}>
                <td className={cx(td, 'font-mono text-[12.5px]')}>{formatTime(r.at)}</td>
                <td className={cx(td, 'font-medium')}>{r.client}{r.platform ? ` · ${r.platform}` : ''}</td>
                <td className={cx(td, 'max-w-[280px] truncate font-mono text-[12px] text-muted')}>{r.ua}</td>
                <td className={td}><Badge tone={r.status === 200 ? 'ok' : 'err'}>{r.status}</Badge></td>
                <td className={cx(td, 'font-mono text-[12.5px]')}>{r.ms} ms</td>
                <td className={td}>{{ fresh: '新渲染', cache: '缓存', 'last-good': '上次成功结果', failed: '失败', unsupported: '不支持' }[r.source] ?? r.source}</td>
                <td className={td}>{r.warnings ? <Badge tone="warn">{r.warnings}</Badge> : '0'}</td>
              </tr>
            ))}
            {!log.data?.length && <tr><td className={cx(td, 'text-muted')} colSpan={7}>还没有访问记录</td></tr>}
          </tbody>
        </table>
      </Card>
    </>
  );
}

export function TabBase() {
  const { draft, setDraft, baseValid, setBaseValid, baseEditorKey } = useProfile();
  const presets = useList('presets').data ?? [];
  const preset = presets.find((p) => p.id === draft.base?.presetId);
  const mode = draft.base === undefined ? 'none' : draft.base.presetId !== undefined ? 'preset' : 'custom';
  const patch = draft.base?.patch ?? {};
  const changePatch = (patch: Record<string, unknown>) => setDraft({ ...draft, base: { ...draft.base, patch } });

  return (
    <div className="flex flex-wrap items-start gap-5">
      <Card title="来源" className="min-w-0 flex-[1_1_320px]">
        <fieldset disabled={!baseValid} className="m-0 flex min-w-0 flex-col gap-3.5 border-0 p-0">
          <Segmented label="基础设置来源" value={mode} options={[{ value: 'preset', label: '引用预设' }, { value: 'custom', label: '完全自定义' }, { value: 'none', label: '不输出' }]}
            onChange={(m) => {
              if (m === 'none') { const { base: _b, ...rest } = draft; setDraft(rest); }
              else if (m === 'custom') setDraft({ ...draft, base: { patch: draft.base?.patch ?? {} } });
              else setDraft({ ...draft, base: { ...(draft.base ?? {}), presetId: presets[0]?.id ?? '' } });
            }} />
          {mode === 'preset' && (
            <Field label="预设" hint="预设更新会同步到这里；你只需覆盖需要不同的项">{(id) => (
              <Select id={id} value={draft.base?.presetId ?? ''} onChange={(e) => setDraft({ ...draft, base: { ...draft.base, presetId: e.target.value } })}>
                <option value="" disabled>选择预设</option>
                {presets.map((p) => <option key={p.id} value={p.id}>{p.name}（v{p.version}）</option>)}
              </Select>
            )}</Field>
          )}
          {mode === 'none' && <p className="m-0 text-[13px] text-muted">不输出通用、DNS、TUN 等设置，使用客户端自己的默认值。</p>}
        </fieldset>
      </Card>
      {mode !== 'none' && (
        <Card title={mode === 'preset' ? '覆盖项（mihomo）' : 'mihomo 基础设置'} className="min-w-0 flex-[999_1_520px]">
          <div className="flex flex-col gap-3">
            <DualEditor key={`${draft.id}:${mode}:${draft.base?.presetId ?? ''}:${baseEditorKey}`} value={patch} onChange={changePatch} onValidityChange={setBaseValid}
              toRaw={baseToYaml} fromRaw={baseFromYaml} recoverForm={baseFormFromYaml} rawLabel={mode === 'preset' ? '覆盖项 YAML' : 'mihomo YAML'}
              renderForm={() => mode === 'preset'
                ? <OverrideForm groups={mihomoBaseGroups} base={baseToForm(preset?.mihomo ?? {})} patch={baseToForm(patch)}
                    onChange={(value) => changePatch(baseFromForm(value, patch, preset?.mihomo))} />
                : <SchemaForm groups={mihomoBaseGroups} value={baseToForm(patch)} extra
                    onChange={(value) => changePatch(baseFromForm(value, patch))} />} />
            {preset && (
              <details>
                <summary className="cursor-pointer text-[13px] text-accent">查看预设「{preset.name}」的内容</summary>
                <pre className="mt-2 overflow-x-auto rounded-lg bg-ground p-3 font-mono text-[12px]">{baseToYaml(preset.mihomo)}</pre>
              </details>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

export function TabNodeSets() {
  const { draft, setDraft, allNodeSets, nodeSetName } = useProfile();
  const available = allNodeSets.filter((n) => !draft.nodeSets.some((p) => p.ref.type === n.ref.type && p.ref.id === n.ref.id));
  const [adding, setAdding] = useState<typeof available[number]['ref']>();

  return (
    <Card title="已加入的节点集" bodyClass="overflow-x-auto"
      actions={<div className="flex gap-2">
        <div className="w-56"><NodeSetSelect label="要加入的节点集" value={adding} options={available} onChange={setAdding} placeholder={available.length ? '选择节点集' : '没有可加入的'} /></div>
        <Button disabled={!adding} onClick={() => { if (adding) { setDraft({ ...draft, nodeSets: [...draft.nodeSets, { ref: adding, output: 'provider' }] }); setAdding(undefined); } }}><Plus size={15} />加入</Button>
      </div>}>
      <p className="mx-4 mt-0 mb-3 text-[12.5px] text-muted">默认按源输出 provider，面板中可按源查看、分别更新；inline 会展开到 proxies。代理链和被引用的单个节点不用在这里添加，系统会自动解析。</p>
      {!draft.nodeSets.length ? <div className="px-4 pb-4"><Empty>还没有节点集。</Empty></div> : (
        <table className="w-full border-collapse">
          <thead><tr><th className={th}>节点集</th><th className={th}>输出方式</th><th className={th} /></tr></thead>
          <tbody>
            {draft.nodeSets.map((n, i) => (
              <tr key={`${n.ref.type}:${n.ref.id}`}>
                <td className={cx(td, 'font-medium')}>{nodeSetName(n.ref)} <span className="text-[12px] font-normal text-muted">{n.ref.type === 'source' ? '订阅源' : n.ref.type === 'collection' ? '组合' : '本地节点组'}</span></td>
                <td className={td}><Segmented label="输出方式" value={n.output} options={[{ value: 'provider', label: 'provider' }, { value: 'inline', label: 'inline' }]} onChange={(output) => setDraft({ ...draft, nodeSets: draft.nodeSets.map((x, j) => (j === i ? { ...x, output } : x)) })} /></td>
                <td className={cx(td, 'text-right')}><Button size="sm" variant="ghost" aria-label="移除" onClick={() => setDraft({ ...draft, nodeSets: draft.nodeSets.filter((_, j) => j !== i) })}><Trash2 size={14} /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
