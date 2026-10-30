import { createModal, useModalDraft, useModalPresentation, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '../modals/index.tsx';
import { remoteRuleMatcher, type Matcher } from '@sub-forge/core';

import { useRulesetSources } from '../hooks/useRulesetSources.ts';
import { resolveRepositoryUrlMatch, useRepositoryUrlMatches } from '../hooks/useRepositoryUrlMatches.ts';
import { RulesetPreview } from './RulesetPreview.tsx';
import { Button, Field, FieldError, Input, buttonClass } from './ui.tsx';

type RuleSetMatcher = Extract<Matcher, { kind: 'ruleset' }>;
export const RemoteRuleDialog = createModal<{ value?: string }, RuleSetMatcher>(function RemoteRuleModal({ data: { value }, modal }) {
  const onClose = modal.cancel, onSelect = modal.confirm;
  const [url, setUrl] = useModalDraft(value ?? '');
  let matcher: RuleSetMatcher | undefined;
  let error: string | undefined;
  try { matcher = remoteRuleMatcher(url); } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  const [previewUrl, setPreviewUrl] = useModalDraft<string>();
  const [linking, setLinking] = useModalDraft(false);
  const [linkError, setLinkError] = useModalDraft<string>();
  const repositoryMatches = useModalPresentation(useRepositoryUrlMatches(matcher?.remote ? [matcher.remote.url] : []));
  const source = { id: 'remote', kind: 'remote' as const, format: 'auto' as const, url: previewUrl };
  const loaded = useModalPresentation(useRulesetSources(undefined, previewUrl ? { id: '', name: '', sources: [source] } : undefined));
  return <ModalContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl" aria-describedby={undefined}><ModalHeader><ModalTitle>{"远程链接"}</ModalTitle></ModalHeader><div className="flex min-h-0 flex-col gap-3.5">
    <Field label="规则地址">{id => <Input id={id} type="url" disabled={linking} value={url} placeholder="远程规则文件的 HTTP 或 HTTPS 地址" onChange={e => { setUrl(e.target.value); setPreviewUrl(undefined); setLinkError(undefined); }} />}</Field>
    <p className="m-0 text-[13px] text-ink-muted">直接引用自己或第三方维护的规则，自动识别格式并输出 .list。</p>
    {url && error && <FieldError error={error} />}
    {linkError && <FieldError error={linkError} />}
    {repositoryMatches.error && <FieldError error="仓库匹配检查失败，请稍后重试" />}
    {matcher?.remote && repositoryMatches.matches[matcher.remote.url]?.map(match => <div key={`${match.repo}:${match.ref}:${match.path}`} className="flex flex-wrap items-center gap-2 rounded border border-line bg-ground px-3 py-2 text-[12.5px]">
      <span className="min-w-0 flex-1">匹配到仓库文件：{match.hint}</span>
      <Button size="sm" disabled={linking} onClick={async () => {
        setLinking(true); setLinkError(undefined);
        try { onSelect(await resolveRepositoryUrlMatch(matcher.remote!.url, match)); }
        catch (cause) { setLinkError(cause instanceof Error ? cause.message : String(cause)); }
        finally { setLinking(false); }
      }}>引用仓库文件</Button>
    </div>)}
    <div><Button disabled={!matcher || loaded.reading && !!previewUrl} onClick={() => { if (matcher) setPreviewUrl(matcher.remote!.url); }}>读取并预览</Button></div>
    {previewUrl && <RulesetPreview key={previewUrl} inputs={loaded.inputs} ready={loaded.ready} overrides={undefined} sourceError={loaded.error} sourceNames={{ remote: '远程规则' }} sourceReading={loaded.reading} onRefreshSources={loaded.refresh} />}
  </div><ModalFooter>{<><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={!matcher || linking} onClick={() => { if (matcher) { onSelect(matcher); } }}>使用此地址</Button></>}</ModalFooter></ModalContent>;
});
export function RemoteRulePicker({ value, label = '引用远程 URL', id, ariaLabel, triggerClassName, onSelect }: {
  value?: string; label?: string; id?: string; ariaLabel?: string; triggerClassName?: string; onSelect: (matcher: RuleSetMatcher) => void;
}) {
  return <><button type="button" id={id} aria-label={ariaLabel} title={value} className={triggerClassName ?? buttonClass('default', 'md', 'min-w-0 max-w-full justify-start text-left')} onClick={async () => { const result = await RemoteRuleDialog.show({ value }); if (result.status === 'confirmed') onSelect(result.data); }}><span className="truncate">{label}</span></button></>;
}
