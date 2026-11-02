import { createModal, useModalDraft, useModalActive, useModalPresentation } from '../modals/index.tsx';
import { useQuery } from '@tanstack/react-query';
import { useDebouncedValue } from '../hooks/useDebouncedValue.ts';
import { rulesetSourceQuery } from '../domain/rulesetSources.ts';
import { normalizeRuleUrl } from '@sub-forge/core';
import type { RuleSetSourceDoc } from '../hooks.ts';
import { newId } from '../convert/templateYaml.ts';
import { RuleEditShell } from './RuleEditShell.tsx';
import { RuleSetPicker } from './RuleSetPicker.tsx';
import { LocalRulesInput } from './LocalRulesInput.tsx';
import { RuleSourcePreview } from './RuleSourcePreview.tsx';
import { Field, Input, Segmented, Select, Button, Badge } from './ui.tsx';

export const RulesetSourceDialog = createModal<{ source: RuleSetSourceDoc; repository?: boolean; adding: boolean }, RuleSetSourceDoc>(function RulesetSource({ data: { source, repository = !!source.repository, adding }, modal }) {
  const onApply = modal.confirm, onClose = modal.cancel;
  const [kind, setKind] = useModalDraft<'repository' | 'remote' | 'local'>(repository ? 'repository' : source.kind);
  const [draft, setDraft] = useModalDraft(source);
  const [attempted, setAttempted] = useModalDraft(false);
  let error: string | undefined;
  if (kind === 'repository' && !draft.repository) error = '请选择关联的仓库文件';
  else if (draft.kind === 'remote') { try { normalizeRuleUrl(draft.url ?? ''); } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); } }
  else if (!draft.content?.trim()) error = '请填写规则内容';
  const active = useModalActive();
  const settled = useDebouncedValue(draft, 400);
  const read = useQuery({ ...rulesetSourceQuery(undefined, settled), enabled: active() && !error && settled === draft });
  const presentation = useModalPresentation(read);
  const status = presentation.data?.status;
  return <RuleEditShell confirmLabel={adding ? '添加' : '保存'} footer={<Button variant="ghost" className="mr-auto" disabled={!!error} onClick={() => void RuleSourcePreview.show({ source: { source: draft } })}>预览原文</Button>} title={adding ? '添加规则来源' : '编辑规则来源'}  error={attempted ? error : undefined}
    onClose={onClose} onApply={() => { setAttempted(true); if (!error) onApply(draft.kind === 'remote' ? { ...draft, url: normalizeRuleUrl(draft.url!) } : draft); }}>
    <Segmented label="规则来源类型" value={kind} options={[{ value: 'repository', label: '规则仓库' }, { value: 'remote', label: '远程地址' }, { value: 'local', label: '本地规则' }]} onChange={kind => { setKind(kind); setAttempted(false); setDraft(current => ({ id: current.id, name: current.name, kind: kind === 'local' ? 'local' : 'remote', format: 'auto', ...(kind === 'local' ? { content: current.content ?? '' } : { url: '' }) })); }} />
    <Field label="名称">{id => <Input id={id} placeholder="用于区分来源，可选" value={draft.name ?? ''} onChange={event => setDraft({ ...draft, name: event.target.value || undefined })} />}</Field>
    {kind === 'repository' ? <Field label="仓库文件">{id => <RuleSetPicker id={id} scope="repository" modal label="选择仓库文件" placeholder="搜索并选择要关联的仓库文件" valueLabel={draft.repository ? draft.name ?? draft.repository.path : undefined} onSelect={matcher => {
      const next = matcher.repository?.sources[0];
      if (!next) return;
      setDraft(current => ({ ...current, ...next, id: current.url === next.url && current.repository ? current.id : newId('src') }));
    }} />}</Field> : draft.kind === 'remote' ? <Field label="规则地址">{id => <Input id={id} type="url" className="font-mono" spellCheck={false} placeholder="远程规则文件的 HTTP 或 HTTPS 地址" value={draft.url ?? ''} onChange={event => setDraft({ ...draft, url: event.target.value })} />}</Field>
      : <Field label="规则内容">{id => <LocalRulesInput id={id} value={draft.content ?? ''} placeholder="每行填写一条规则，也可粘贴域名、CIDR 或 YAML payload" onChange={content => setDraft({ ...draft, content })} />}</Field>}
    {kind !== 'repository' && <div className="grid grid-cols-2 items-start gap-4"><Field label="输入格式">{id => <Select id={id} placeholder="选择输入内容的格式" value={draft.format} onChange={event => setDraft({ ...draft, format: event.target.value as RuleSetSourceDoc['format'] })}><option value="auto">自动识别</option><option value="classical">Clash classical</option><option value="domain">域名列表</option><option value="ipcidr">IP-CIDR 列表</option><option value="domain-set">Surge DOMAIN-SET</option><option value="yaml">YAML payload</option><option value="mrs">Mihomo MRS</option><option value="srs">sing-box SRS</option></Select>}</Field><Field label="识别结果">{id => <div id={id} className="flex min-h-9 items-center">{presentation.isFetching ? <span className="text-xs text-muted-foreground">正在识别…</span> : status?.ok ? <Badge tone="accent">{status.conversion === 'yaml-to-list' ? 'YAML → LIST' : status.format ?? '文本'} · {status.rules ?? 0} 条</Badge> : <span className="text-xs text-muted-foreground">{presentation.error || status?.error ? '读取失败，可预览原文重试' : '填写内容后识别'}</span>}</div>}</Field></div>}
  </RuleEditShell>;
});
