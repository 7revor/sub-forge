import { createModal, useModalDraft } from '../modals/index.tsx';
import { normalizeRuleUrl } from '@sub-forge/core';
import type { RuleSetSourceDoc } from '../hooks.ts';
import { newId } from '../convert/templateYaml.ts';
import { RuleEditShell } from './RuleEditShell.tsx';
import { RuleSetPicker } from './RuleSetPicker.tsx';
import { LocalRulesInput } from './LocalRulesInput.tsx';
import { Field, Input, Segmented, Select } from './ui.tsx';

export const RulesetSourceDialog = createModal<{ source: RuleSetSourceDoc; repository?: boolean; adding: boolean }, RuleSetSourceDoc>(function RulesetSource({ data: { source, repository = !!source.repository, adding }, modal }) {
  const onApply = modal.confirm, onClose = modal.cancel;
  const [kind, setKind] = useModalDraft<'repository' | 'remote' | 'local'>(repository ? 'repository' : source.kind);
  const [draft, setDraft] = useModalDraft(source);
  const [attempted, setAttempted] = useModalDraft(false);
  let error: string | undefined;
  if (kind === 'repository' && !draft.repository) error = '请选择关联的仓库文件';
  else if (draft.kind === 'remote') { try { normalizeRuleUrl(draft.url ?? ''); } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); } }
  else if (!draft.content?.trim()) error = '请填写本地规则内容';
  return <RuleEditShell tall={draft.kind === 'local'} title={adding ? '添加规则来源' : '编辑规则来源'}  error={attempted ? error : undefined}
    onClose={onClose} onApply={() => { setAttempted(true); if (!error) onApply(draft.kind === 'remote' ? { ...draft, url: normalizeRuleUrl(draft.url!) } : draft); }}>
    <Segmented label="规则来源类型" value={kind} options={[{ value: 'repository', label: '规则仓库' }, { value: 'remote', label: '远程地址' }, { value: 'local', label: '手写' }]} onChange={kind => { setKind(kind); setAttempted(false); setDraft(current => ({ id: current.id, name: current.name, kind: kind === 'local' ? 'local' : 'remote', format: 'auto', ...(kind === 'local' ? { content: current.content ?? '' } : { url: '' }) })); }} />
    <Field label="名称">{id => <Input id={id} placeholder="用于区分来源，可选" value={draft.name ?? ''} onChange={event => setDraft({ ...draft, name: event.target.value || undefined })} />}</Field>
    {kind === 'repository' ? <Field label="仓库文件">{id => <RuleSetPicker id={id} scope="repository" modal label="选择仓库文件" placeholder="搜索并选择要关联的仓库文件" valueLabel={draft.repository ? draft.name ?? draft.repository.path : undefined} onSelect={matcher => {
      const next = matcher.repository?.sources[0];
      if (!next) return;
      setDraft(current => ({ ...current, ...next, id: current.url === next.url && current.repository ? current.id : newId('src') }));
    }} />}</Field> : draft.kind === 'remote' ? <Field label="规则地址">{id => <Input id={id} type="url" spellCheck={false} placeholder="远程规则文件的 HTTP 或 HTTPS 地址" value={draft.url ?? ''} onChange={event => setDraft({ ...draft, url: event.target.value })} />}</Field>
      : <Field label="本地规则内容">{id => <LocalRulesInput id={id} value={draft.content ?? ''} placeholder="每行填写一条规则，也可粘贴域名、CIDR 或 YAML payload" onChange={content => setDraft({ ...draft, content })} />}</Field>}
    {kind !== 'repository' && <Field label="输入格式">{id => <Select id={id} placeholder="选择输入内容的格式" value={draft.format} onChange={event => setDraft({ ...draft, format: event.target.value as RuleSetSourceDoc['format'] })}><option value="auto">自动识别</option><option value="classical">Clash classical</option><option value="domain">域名列表</option><option value="ipcidr">IP-CIDR 列表</option><option value="domain-set">Surge DOMAIN-SET</option><option value="yaml">YAML payload</option><option value="mrs">Mihomo MRS</option><option value="srs">sing-box SRS</option></Select>}</Field>}
  </RuleEditShell>;
});
