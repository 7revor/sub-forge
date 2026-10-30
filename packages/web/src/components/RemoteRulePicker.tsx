import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog.tsx';
import { remoteRuleMatcher, type Matcher } from '@sub-forge/core';
import { useEffect, useState } from 'react';
import { useRulesetSources } from '../hooks/useRulesetSources.ts';
import { resolveRepositoryUrlMatch, useRepositoryUrlMatches } from '../hooks/useRepositoryUrlMatches.ts';
import { RulesetPreview } from './RulesetPreview.tsx';
import { Button, Field, FieldError, Input, buttonClass } from './ui.tsx';
import { useDialogDraft } from '../hooks/useDialogDraft.ts';
import { useDialogPresentation } from '../hooks/useDialogPresentation.ts';

type RuleSetMatcher = Extract<Matcher, { kind: 'ruleset' }>;
function RemoteRuleDialog({ open, value, onSelect, onClose }: { open: boolean; value?: string; onSelect: (matcher: RuleSetMatcher) => void; onClose: () => void }) {
  const [url, setUrl] = useDialogDraft(open, value ?? '');
  const [repositoryMatcher, setRepositoryMatcher] = useDialogDraft<RuleSetMatcher | undefined>(open, undefined);
  let matcher: RuleSetMatcher | undefined;
  let error: string | undefined;
  try { matcher = remoteRuleMatcher(url); } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string>();
  useEffect(() => { if (open) { setPreviewUrl(undefined); setLinkError(undefined); } }, [open]);
  const repositoryQuery = useRepositoryUrlMatches(open && matcher?.remote ? [matcher.remote.url] : []);
  const repositoryMatches = useDialogPresentation(open, repositoryQuery);
  const source = { id: 'remote', kind: 'remote' as const, format: 'auto' as const, url: previewUrl };
  const sourceQuery = useRulesetSources(undefined, previewUrl ? { id: '', name: '', sources: [source] } : undefined);
  const loaded = useDialogPresentation(open, sourceQuery);
  return <Dialog open={open} onOpenChange={next => { if (!next && !linking) onClose(); }}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl" aria-describedby={undefined}><DialogHeader><DialogTitle>{"远程链接"}</DialogTitle></DialogHeader><div className="flex min-h-0 flex-col gap-3.5">
    <Field label="规则地址">{id => <Input id={id} type="url" disabled={linking} value={url} placeholder="https://example.com/rules.yaml" onChange={e => { setUrl(e.target.value); setRepositoryMatcher(undefined); setPreviewUrl(undefined); setLinkError(undefined); }} />}</Field>
    <p className="m-0 text-[13px] text-ink-muted">直接引用自己或第三方维护的规则，自动识别格式并输出 .list。</p>
    {url && error && <FieldError error={error} />}
    {linkError && <FieldError error={linkError} />}
    {repositoryMatches.error && <FieldError error="仓库匹配检查失败，请稍后重试" />}
    {matcher?.remote && repositoryMatches.matches[matcher.remote.url]?.map(match => <div key={`${match.repo}:${match.ref}:${match.path}`} className="flex flex-wrap items-center gap-2 rounded border border-line bg-ground px-3 py-2 text-[12.5px]">
      <span className="min-w-0 flex-1">匹配到仓库文件：{match.hint}</span>
      <Button size="sm" disabled={linking} onClick={async () => {
        setLinking(true); setLinkError(undefined);
        try { setRepositoryMatcher(structuredClone(await resolveRepositoryUrlMatch(matcher.remote!.url, match))); }
        catch (cause) { setLinkError(cause instanceof Error ? cause.message : String(cause)); }
        finally { setLinking(false); }
      }}>选择仓库文件</Button>
    </div>)}
    {repositoryMatcher && <span className="text-[12.5px] text-ink-muted">已选择仓库文件，保存后加入规则。</span>}
    <div><Button disabled={!matcher || loaded.reading && !!previewUrl} onClick={() => { if (matcher) setPreviewUrl(matcher.remote!.url); }}>读取并预览</Button></div>
    {previewUrl && <RulesetPreview key={previewUrl} inputs={loaded.inputs} ready={loaded.ready} overrides={undefined} sourceError={loaded.error} sourceNames={{ remote: '远程规则' }} sourceReading={loaded.reading} onRefreshSources={loaded.refresh} />}
  </div><DialogFooter>{<><Button disabled={linking} onClick={onClose}>取消</Button><Button variant="primary" disabled={!matcher || linking} onClick={() => { if (matcher) { onSelect(structuredClone(repositoryMatcher ?? matcher)); onClose(); } }}>保存</Button></>}</DialogFooter></DialogContent></Dialog>;
}
export function RemoteRulePicker({ value, label = '引用远程 URL', id, ariaLabel, triggerClassName, onSelect }: {
  value?: string; label?: string; id?: string; ariaLabel?: string; triggerClassName?: string; onSelect: (matcher: RuleSetMatcher) => void;
}) {
  const [open, setOpen] = useState(false);
  return <><button type="button" id={id} aria-label={ariaLabel} title={value} className={triggerClassName ?? buttonClass('default', 'md', 'min-w-0 max-w-full justify-start text-left')} onClick={() => setOpen(true)}><span className="truncate">{label}</span></button><RemoteRuleDialog open={open} value={value} onSelect={onSelect} onClose={() => setOpen(false)} /></>;
}
