import { remoteRuleMatcher, type Matcher } from '@sub-forge/core';
import { useState } from 'react';
import { Presence } from './Presence.tsx';
import { useRulesetSources } from '../hooks/useRulesetSources.ts';
import { resolveRepositoryUrlMatch, useRepositoryUrlMatches } from '../hooks/useRepositoryUrlMatches.ts';
import { RulesetPreview } from './RulesetPreview.tsx';
import { Button, Field, FieldError, Input, Modal, buttonClass } from './ui.tsx';

type RuleSetMatcher = Extract<Matcher, { kind: 'ruleset' }>;
function RemoteRuleDialog({ open, value, onSelect, onClose }: { open: boolean; value?: string; onSelect: (matcher: RuleSetMatcher) => void; onClose: () => void }) {
  const [url, setUrl] = useState(value ?? '');
  let matcher: RuleSetMatcher | undefined;
  let error: string | undefined;
  try { matcher = remoteRuleMatcher(url); } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string>();
  const repositoryMatches = useRepositoryUrlMatches(matcher?.remote ? [matcher.remote.url] : []);
  const source = { id: 'remote', kind: 'remote' as const, format: 'auto' as const, url: previewUrl };
  const loaded = useRulesetSources(undefined, previewUrl ? { id: '', name: '', sources: [source] } : undefined);
  return <Modal title="远程链接" open={open} wide onClose={onClose} footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={!matcher || linking} onClick={() => { if (matcher) { onSelect(matcher); onClose(); } }}>使用此地址</Button></>}>
    <Field label="规则地址">{id => <Input id={id} type="url" disabled={linking} value={url} placeholder="https://example.com/rules.yaml" onChange={e => { setUrl(e.target.value); setPreviewUrl(undefined); setLinkError(undefined); }} />}</Field>
    <p className="m-0 text-[13px] text-muted">直接引用自己或第三方维护的规则，自动识别格式并输出 .list。</p>
    {url && error && <FieldError error={error} />}
    {linkError && <FieldError error={linkError} />}
    {repositoryMatches.error && <FieldError error="仓库匹配检查失败，请稍后重试" />}
    {matcher?.remote && repositoryMatches.matches[matcher.remote.url]?.map(match => <div key={`${match.repo}:${match.ref}:${match.path}`} className="flex flex-wrap items-center gap-2 rounded border border-line bg-ground px-3 py-2 text-[12.5px]">
      <span className="min-w-0 flex-1">匹配到仓库文件：{match.hint}</span>
      <Button size="sm" disabled={linking} onClick={async () => {
        setLinking(true); setLinkError(undefined);
        try { onSelect(await resolveRepositoryUrlMatch(matcher.remote!.url, match)); onClose(); }
        catch (cause) { setLinkError(cause instanceof Error ? cause.message : String(cause)); }
        finally { setLinking(false); }
      }}>引用仓库文件</Button>
    </div>)}
    <div><Button disabled={!matcher || loaded.reading && !!previewUrl} onClick={() => { if (matcher) setPreviewUrl(matcher.remote!.url); }}>读取并预览</Button></div>
    {previewUrl && <RulesetPreview key={previewUrl} inputs={loaded.inputs} ready={loaded.ready} overrides={undefined} sourceError={loaded.error} sourceNames={{ remote: '远程规则' }} sourceReading={loaded.reading} onRefreshSources={loaded.refresh} />}
  </Modal>;
}
export function RemoteRulePicker({ value, label = '引用远程 URL', id, ariaLabel, triggerClassName, onSelect }: {
  value?: string; label?: string; id?: string; ariaLabel?: string; triggerClassName?: string; onSelect: (matcher: RuleSetMatcher) => void;
}) {
  const [open, setOpen] = useState(false);
  return <><button type="button" id={id} aria-label={ariaLabel} title={value} className={triggerClassName ?? buttonClass('default', 'md', 'min-w-0 max-w-full justify-start text-left')} onClick={() => setOpen(true)}><span className="truncate">{label}</span></button><Presence open={open}>{visible => <RemoteRuleDialog open={visible} value={value} onSelect={onSelect} onClose={() => setOpen(false)} />}</Presence></>;
}
