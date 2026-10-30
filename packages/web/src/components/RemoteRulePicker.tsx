import { createModal, useModalDraft, useModalPresentation, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '../modals/index.tsx';
import { remoteRuleMatcher, type Matcher } from '@sub-forge/core';
import { useRulesetSources } from '../hooks/useRulesetSources.ts';
import { RulesetPreview } from './RulesetPreview.tsx';
import { Button, Field, FieldError, Input, buttonClass } from './ui.tsx';

type RuleSetMatcher = Extract<Matcher, { kind: 'ruleset' }>;
export const RemoteRuleDialog = createModal<{ value?: string }, RuleSetMatcher>(function RemoteRule({ data: { value }, modal }) {
  const onSelect = modal.confirm, onClose = modal.cancel;
  const [url, setUrl] = useModalDraft(value ?? '');
  let matcher: RuleSetMatcher | undefined;
  let error: string | undefined;
  try { matcher = remoteRuleMatcher(url); } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  const [previewUrl, setPreviewUrl] = useModalDraft<string>();
  const source = { id: 'remote', kind: 'remote' as const, format: 'auto' as const, url: previewUrl };
  const loaded = useModalPresentation(useRulesetSources(undefined, previewUrl ? { id: '', name: '', sources: [source] } : undefined));
  return <ModalContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl" aria-describedby={undefined}><ModalHeader><ModalTitle>{"远程链接"}</ModalTitle></ModalHeader><div className="flex min-h-0 flex-col gap-3.5">
    <Field label="规则地址">{id => <Input id={id} type="url" value={url} placeholder="远程规则文件的 HTTP 或 HTTPS 地址" onChange={e => { setUrl(e.target.value); setPreviewUrl(undefined); }} />}</Field>
    <p className="m-0 text-[13px] text-ink-muted">直接引用自己或第三方维护的规则，自动识别格式并输出 .list。</p>
    {url && error && <FieldError error={error} />}
    <div><Button disabled={!matcher || loaded.reading && !!previewUrl} onClick={() => { if (matcher) setPreviewUrl(matcher.remote!.url); }}>读取并预览</Button></div>
    {previewUrl && <RulesetPreview key={previewUrl} inputs={loaded.inputs} ready={loaded.ready} overrides={undefined} sourceError={loaded.error} sourceNames={{ remote: '远程规则' }} sourceReading={loaded.reading} onRefreshSources={loaded.refresh} />}
  </div><ModalFooter>{<><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={!matcher} onClick={() => { if (matcher) { onSelect(matcher); } }}>使用此地址</Button></>}</ModalFooter></ModalContent>;
});
export function RemoteRulePicker({ value, label = '引用远程 URL', id, ariaLabel, triggerClassName, onSelect }: {
  value?: string; label?: string; id?: string; ariaLabel?: string; triggerClassName?: string; onSelect: (matcher: RuleSetMatcher) => void;
}) {
  return <><button type="button" id={id} aria-label={ariaLabel} title={value} className={triggerClassName ?? buttonClass('default', 'md', 'min-w-0 max-w-full justify-start text-left')} onClick={async () => { const result = await RemoteRuleDialog.show({ value }); if (result.status === 'confirmed') onSelect(result.data); }}><span className="truncate">{label}</span></button></>;
}
