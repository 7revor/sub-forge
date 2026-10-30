import { remoteRuleMatcher, type Matcher } from '@sub-forge/core';
import { useEffect, useState } from 'react';
import { useRulesetSources } from '../hooks/useRulesetSources.ts';
import { RulesetPreview } from './RulesetPreview.tsx';
import { Button, Field, FieldError, Input, Modal, buttonClass } from './ui.tsx';

type RuleSetMatcher = Extract<Matcher, { kind: 'ruleset' }>;
function RemoteRuleDialog({ open, value, onSelect, onClose }: { open: boolean; value?: string; onSelect: (matcher: RuleSetMatcher) => void; onClose: () => void }) {
  const [url, setUrl] = useState(value ?? '');
  let matcher: RuleSetMatcher | undefined;
  let error: string | undefined;
  try { matcher = remoteRuleMatcher(url); } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  const [previewUrl, setPreviewUrl] = useState<string>();
  useEffect(() => { if (open) { setUrl(value ?? ''); setPreviewUrl(undefined); } }, [open, value]);
  const source = { id: 'remote', kind: 'remote' as const, format: 'auto' as const, url: previewUrl };
  const loaded = useRulesetSources(undefined, previewUrl ? { id: '', name: '', sources: [source] } : undefined);
  return <Modal title="远程链接" open={open} wide onClose={onClose} footer={<><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={!matcher} onClick={() => { if (matcher) { onSelect(matcher); onClose(); } }}>使用此地址</Button></>}>
    <Field label="规则地址">{id => <Input id={id} type="url" value={url} placeholder="https://example.com/rules.yaml" onChange={e => { setUrl(e.target.value); setPreviewUrl(undefined); }} />}</Field>
    <p className="m-0 text-[13px] text-muted">直接引用自己或第三方维护的规则，自动识别格式并输出 .list。</p>
    {url && error && <FieldError error={error} />}
    <div><Button disabled={!matcher || loaded.reading && !!previewUrl} onClick={() => { if (matcher) setPreviewUrl(matcher.remote!.url); }}>读取并预览</Button></div>
    {previewUrl && <RulesetPreview key={previewUrl} inputs={loaded.inputs} ready={loaded.ready} overrides={undefined} sourceError={loaded.error} sourceNames={{ remote: '远程规则' }} sourceReading={loaded.reading} onRefreshSources={loaded.refresh} />}
  </Modal>;
}
export function RemoteRulePicker({ value, label = '引用远程 URL', id, ariaLabel, triggerClassName, onSelect }: {
  value?: string; label?: string; id?: string; ariaLabel?: string; triggerClassName?: string; onSelect: (matcher: RuleSetMatcher) => void;
}) {
  const [open, setOpen] = useState(false);
  return <><button type="button" id={id} aria-label={ariaLabel} title={value} className={triggerClassName ?? buttonClass('default', 'md', 'min-w-0 max-w-full justify-start text-left')} onClick={() => setOpen(true)}><span className="truncate">{label}</span></button><RemoteRuleDialog open={open} value={value} onSelect={onSelect} onClose={() => setOpen(false)} /></>;
}
