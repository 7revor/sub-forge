import { createModal, useModalDraft, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '../modals/index.tsx';
import { remoteRuleMatcher, type Matcher } from '@sub-forge/core';
import { RemoteRuleInput } from './RemoteRuleInput.tsx';
import { Button, Field, FieldError, buttonClass } from './ui.tsx';

type RuleSetMatcher = Extract<Matcher, { kind: 'ruleset' }>;
export const RemoteRuleDialog = createModal<{ value?: string }, RuleSetMatcher>(function RemoteRule({ data: { value }, modal }) {
  const onSelect = modal.confirm, onClose = modal.cancel;
  const [url, setUrl] = useModalDraft(value ?? '');
  let matcher: RuleSetMatcher | undefined;
  let error: string | undefined;
  try { matcher = remoteRuleMatcher(url); } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  return <ModalContent className="max-h-[85dvh] overflow-y-auto" aria-describedby={undefined}><ModalHeader><ModalTitle>{"远程链接"}</ModalTitle></ModalHeader><div className="flex min-h-0 flex-col gap-4">
    <Field label="规则地址">{id => <RemoteRuleInput id={id} value={url} onChange={setUrl} />}</Field>
    <p className="m-0 text-[length:var(--text-caption)] text-ink-muted">自动识别远程规则格式，确认后引用此地址。</p>
    {url && error && <FieldError error={error} />}
  </div><ModalFooter>{<><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={!matcher} onClick={() => { if (matcher) { onSelect(matcher); } }}>使用此地址</Button></>}</ModalFooter></ModalContent>;
});
export function RemoteRulePicker({ value, label = '引用远程 URL', id, ariaLabel, triggerClassName, onSelect }: {
  value?: string; label?: string; id?: string; ariaLabel?: string; triggerClassName?: string; onSelect: (matcher: RuleSetMatcher) => void;
}) {
  return <><button type="button" id={id} aria-label={ariaLabel} title={value} className={triggerClassName ?? buttonClass('default', 'md', 'min-w-0 max-w-full justify-start text-left')} onClick={async () => { const result = await RemoteRuleDialog.show({ value }); if (result.status === 'confirmed') onSelect(result.data); }}><span className="truncate">{label}</span></button></>;
}
