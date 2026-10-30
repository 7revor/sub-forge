import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog.tsx';
import { persistedProfile } from './routing.ts';
import { CodePreview } from '../../components/CodePreview.tsx';
// 代理链（链规则 + 依赖节点面板，REF-03 / REF-07）与预览（按平台查看最终配置与渲染报告）。

import { useMutation } from '@tanstack/react-query';
import type { ChainRule, Platform, RefStrategy, YamlClient } from '@sub-forge/core';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type ProfilePreview } from '../../api.ts';
import { MatchPreview } from '../../components/MatchPreview.tsx';
import { NodeSetSelect, TargetPicker, targetLabel } from '../../components/pickers.tsx';
import { Badge, Button, Card, Empty, ErrorAlert, Field, Input, ReportList, Segmented, Select, td, th, cx } from '../../components/ui.tsx';
import { useProfile } from './context.ts';
import { useDialogDraft } from '../../hooks/useDialogDraft.ts';

const STRATEGIES: { value: RefStrategy; label: string }[] = [{ value: 'wrap', label: '包装组' }, { value: 'copy', label: '复制到本地' }, { value: 'inline', label: '整体内联' }];

function usePreview() {
  const { draft } = useProfile();
  return useMutation({ mutationFn: ({ platform, client = 'mihomo' }: { platform?: Platform; client?: YamlClient } = {}) => api<ProfilePreview>('POST', draft.id ? `/profiles/${draft.id}/preview` : '/profiles/preview', { profile: persistedProfile(draft), client, ...(platform ? { platform } : {}) }) });
}

function Hop({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 rounded-lg border bg-panel px-3 py-2 ${accent ? 'border-[#a9bbea]' : 'border-[#d5d9e0]'}`}>
      <span className="text-[11.5px] text-ink-muted">{k}</span><span className="text-[13px] font-medium">{v}</span>
    </div>
  );
}

export function TabChains() {
  const { draft, setDraft, groupOptions, groupName, profileNodeSets, nodeSetName } = useProfile();
  const preview = usePreview();
  const setChain = (i: number, c: ChainRule) => setDraft({ ...draft, chains: draft.chains.map((x, j) => (j === i ? c : x)) });
  // 编辑在对话框里进行：index 为 -1 表示新增
  const [selection, setSelection] = useState<{ index: number; chain: ChainRule }>();
  const [editing, setEditing] = useDialogDraft(!!selection, selection, selection?.chain.id);
  const add = () => {
    const ns = profileNodeSets[0]?.ref;
    if (!ns) return;
    setSelection({ index: -1, chain: { id: `c_${Date.now().toString(36)}`, landing: { nodeSet: ns }, via: { kind: 'group', groupId: groupOptions[0]?.id ?? '' } } });
  };
  const commit = () => {
    if (!editing) return;
    const saved = structuredClone(editing.chain);
    if (editing.index < 0) setDraft({ ...draft, chains: [...draft.chains, saved] });
    else setChain(editing.index, saved);
    setSelection(undefined);
  };
  const perRef = draft.refPolicy.perRef ?? {};
  const chainReport = (preview.data?.report ?? []).filter((r) =>
    (r.level === 'warn' || r.level === 'error') && (r.code.startsWith('chain.') || r.code.startsWith('ref.')));

  return (
    <>
      <Card title={`链规则`}
        actions={<Button onClick={add} disabled={!profileNodeSets.length}><Plus size={15} />添加链规则</Button>}>
        {!draft.chains.length ? <Empty title={profileNodeSets.length ? '还没有链规则' : '还没有节点集'} description={profileNodeSets.length ? undefined : '先在「节点集」中加入节点集。'} /> : (
          <div className="flex flex-col gap-3">
            {draft.chains.map((c, i) => (
              <div key={c.id} className="flex flex-col gap-3 rounded-[10px] border border-line bg-[#fafbfc] p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[13.5px] font-semibold">#{i + 1} · {nodeSetName(c.landing.nodeSet)}{c.landing.filter ? ` 中命中 ${c.landing.filter} 的节点` : ' 全部节点'}经由「{targetLabel(c.via, groupName, nodeSetName)}」</span>
                  <div className="flex gap-1.5">
                    <Button size="sm" onClick={() => setSelection({ index: i, chain: c })}>编辑</Button>
                    <Button size="sm" variant="ghost" className="w-8 px-0" aria-label={`删除链规则 ${i + 1}`} onClick={() => setDraft({ ...draft, chains: draft.chains.filter((_, j) => j !== i) })}><Trash2 size={14} /></Button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Hop k="客户端" v="本机" />
                  <ArrowRight size={18} className="text-faint" aria-hidden="true" />
                  <Hop k={c.via.kind === 'group' ? '策略组' : c.via.kind === 'node' ? `${nodeSetName(c.via.ref.nodeSet)} 节点` : '内置'} v={targetLabel(c.via, groupName, nodeSetName)} accent />
                  <ArrowRight size={18} className="text-faint" aria-hidden="true" />
                  <Hop k={nodeSetName(c.landing.nodeSet)} v={c.landing.filter || c.landing.excludeFilter ? `筛选 ${c.landing.filter ?? '全部'}${c.landing.excludeFilter ? ` 排除 ${c.landing.excludeFilter}` : ''}` : '全部节点'} />
                  <ArrowRight size={18} className="text-faint" aria-hidden="true" />
                  <Hop k="目标" v="互联网" />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {chainReport.length > 0 && <Card title="代理链告警" bodyClass="px-4 pb-2"><ReportList items={chainReport} /></Card>}
      <Card title={`依赖节点`}
        actions={<>
          <label className="flex items-center gap-2 text-[12.5px] text-ink-2">Profile 默认
            <Select className="h-9 w-auto" value={draft.refPolicy.default} onChange={(e) => setDraft({ ...draft, refPolicy: { ...draft.refPolicy, default: e.target.value as RefStrategy } })}>
              {STRATEGIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select></label>
          <Button onClick={() => preview.mutate({})} disabled={preview.isPending}>{preview.isPending ? '解析中…' : '解析依赖'}</Button>
        </>} bodyClass="overflow-x-auto">
        <ErrorAlert error={preview.error} />
        {!preview.data ? <div className="px-4 pb-4"><Empty title="还没有依赖解析结果" /></div> : !preview.data.dependencies?.length ? <div className="px-4 pb-4"><Empty title="没有引用 provider 中的单个节点" /></div> : (
          <table className="w-full min-w-[760px] border-collapse">
            <thead><tr><th className={th}>被引用的节点</th><th className={th}>生成项</th><th className={th}>引用来源</th><th className={th}>解析策略</th></tr></thead>
            <tbody>
              {preview.data.dependencies.map((d) => (
                <tr key={d.refKey}>
                  <td className={td}><div className="flex flex-col gap-0.5"><span className="font-medium">{d.node}</span><span className="text-[12px] text-ink-muted">{d.nodeSet}</span></div></td>
                  <td className={cx(td, 'font-mono text-[12.5px]')}>{d.output}</td>
                  <td className={cx(td, 'text-[12.5px] text-ink-2')}>{d.usedBy.join('、')}</td>
                  <td className={td}><Segmented label="解析策略" value={perRef[d.refKey] ?? draft.refPolicy.default} options={STRATEGIES}
                    onChange={(v) => setDraft({ ...draft, refPolicy: { ...draft.refPolicy, perRef: { ...perRef, [d.refKey]: v } } })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {preview.data && <p className="mx-4 mt-3 mb-0 text-[12.5px] leading-relaxed text-ink-muted">依赖节点不可用时拒绝连接。</p>}
      </Card>
      <Dialog open={!!selection} onOpenChange={next => { if (!next) setSelection(undefined); }}><DialogContent className="max-h-[85dvh] overflow-y-auto" aria-describedby={undefined}><DialogHeader><DialogTitle>{editing?.index === -1 ? '添加链规则' : `编辑链规则 #${(editing?.index ?? 0) + 1}`}</DialogTitle></DialogHeader><div className="flex min-h-0 flex-col gap-3.5">
        {editing && (() => {
          const c = editing.chain;
          const put = (chain: ChainRule) => setEditing({ ...editing, chain: structuredClone(chain) });
          return <>
            <span className="text-[12.5px] font-medium text-ink-muted">落地（哪些节点经由前置出去）</span>
            <div className="grid grid-cols-2 gap-3">
              <Field label="节点集">{() => <NodeSetSelect label="落地节点集" value={c.landing.nodeSet} options={profileNodeSets} onChange={(nodeSet) => put({ ...c, landing: { ...c.landing, nodeSet } })} />}</Field>
              <Field label="筛选（正则，留空为全部）">{(id) => <Input id={id} className="font-mono" value={c.landing.filter ?? ''} onChange={(e) => put({ ...c, landing: { ...c.landing, filter: e.target.value || undefined } })} />}</Field>
              <Field label="排除（正则）" className="col-span-2">{(id) => <Input id={id} className="font-mono" value={c.landing.excludeFilter ?? ''} onChange={(e) => put({ ...c, landing: { ...c.landing, excludeFilter: e.target.value || undefined } })} />}</Field>
            </div>
            <MatchPreview nodeSet={c.landing.nodeSet} filter={c.landing.filter} excludeFilter={c.landing.excludeFilter} />
            <div className="flex flex-col gap-1.5 border-t border-line-2 pt-3"><span className="text-[12.5px] font-medium text-ink-muted">前置</span>
              <TargetPicker label="前置" value={c.via} onChange={(via) => put({ ...c, via })} groups={groupOptions} nodeSets={profileNodeSets} /></div>
          </>;
        })()}
      </div><DialogFooter><Button onClick={() => setSelection(undefined)}>取消</Button><Button variant="primary" onClick={commit}>保存</Button></DialogFooter></DialogContent></Dialog>
    </>
  );
}

const PLATFORMS: { value: Platform | 'any'; label: string }[] = [{ value: 'any', label: '不区分' }, { value: 'macos', label: 'macOS' }, { value: 'windows', label: 'Windows' }, { value: 'android', label: 'Android' }, { value: 'linux', label: 'Linux' }];

export function TabPreview() {
  const { draft } = useProfile();
  const preview = usePreview();
  const [platform, setPlatform] = useState<Platform | 'any'>('any');
  const [client, setClient] = useState<YamlClient>('mihomo');
  const platforms = client === 'stash' ? [{ value: 'ios', label: 'iOS' }, { value: 'macos', label: 'macOS' }] : PLATFORMS;
  const target = { client, ...(platform === 'any' ? {} : { platform }) };
  const current = preview.data && !preview.isPending && !preview.error && JSON.stringify(preview.variables) === JSON.stringify(target);
  const report = preview.data?.report ?? [];
  const count = (l: string) => report.filter((r) => r.level === l).length;
  // 打开标签或切换平台时自动渲染当前草稿
  useEffect(() => { preview.mutate(target); }, [client, platform]); // eslint-disable-line react-hooks/exhaustive-deps
  const exportFile = () => {
    const yaml = client === 'stash' ? preview.data?.exportYaml : preview.data?.yaml;
    if (!yaml || !current) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([yaml], { type: 'text/yaml' }));
    a.download = `${draft.name || 'config'}.yaml`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="客户端" value={client} options={[{ value: 'mihomo', label: 'mihomo' }, { value: 'stash', label: 'Stash' }, { value: 'surge', label: 'Surge', disabled: true, title: 'Surge 暂未开放' }]} onChange={(value) => { if (value === 'surge') return; preview.reset(); setClient(value); setPlatform(value === 'stash' ? 'ios' : 'any'); }} />
        <label className="flex items-center gap-2 whitespace-nowrap text-[13px] text-ink-2">平台
          <Select className="w-auto" value={platform} onChange={(e) => setPlatform(e.target.value as Platform | 'any')}>{platforms.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select></label>
        <Button onClick={() => preview.mutate(target)} disabled={preview.isPending}>{preview.isPending ? '渲染中…' : '重新渲染'}</Button>
        <Button onClick={exportFile} disabled={!current || !preview.data?.ok || !preview.data?.yaml}>导出文件</Button>
        <span className="text-[12.5px] text-ink-muted">当前草稿预览</span>
      </div>
      <ErrorAlert error={preview.error} />
      {client === 'stash' && <p className="text-[12.5px] text-ink-muted">Stash 节点随主订阅刷新更新；节点集内联输出，空策略组保持拒绝连接。导出文件会内嵌已转换的规则，可直接导入。</p>}
      {current && (
        <div className="flex flex-wrap items-start gap-5">
          <CodePreview label="最终配置" className="flex-[999_1_560px] rounded-[10px]" title={`config.yaml · ${preview.data.yaml?.split('\n').length ?? 0} 行`} text={preview.data.yaml ?? preview.data.failure ?? ''} copyable={!!preview.data.yaml} bodyClassName="max-h-[720px] p-4 text-[12.5px] leading-[1.75]" />
          <section aria-label="渲染报告" className="flex min-w-0 flex-[1_1_340px] flex-col gap-3">
            <div className="grid grid-cols-3 gap-2">
              {[['错误', count('error'), 'text-err'], ['告警', count('warn'), 'text-warn'], ['提示', count('info'), 'text-accent-ink']].map(([t, n, c]) => (
                <div key={t as string} className="flex flex-col gap-0.5 rounded-[10px] border border-line bg-panel px-3 py-2.5"><span className="text-[12px] text-ink-muted">{t}</span><span className={`text-[22px] font-semibold ${c}`}>{n}</span></div>
              ))}
            </div>
            <Card title="渲染报告" bodyClass="px-4 pb-2">
              {!preview.data.ok && <div className="mb-2"><Badge tone="err">渲染失败，订阅接口会返回上一份成功结果</Badge></div>}
              <ReportList items={report} />
            </Card>
          </section>
        </div>
      )}
    </>
  );
}
