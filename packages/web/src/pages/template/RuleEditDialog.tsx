import { remoteRuleMatcher, withIpOptions, type Matcher, type RuleEntry } from '@sub-forge/core';
import { useRef, useState, type ReactNode } from 'react';
import { clientOverridesError, ruleInputError } from '../../components/ClientOverrides.tsx';
import { MatcherEditor } from '../../components/MatcherEditor.tsx';
import { Button, ErrorAlert, FieldError } from '../../components/ui.tsx';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog.tsx';
import { resolveRepositoryUrlMatch, useRepositoryUrlMatches, type RepositoryUrlMatch } from '../../hooks/useRepositoryUrlMatches.ts';
import type { ConvertCtx } from '../../convert/templateYaml.ts';

export const repositoryHintClass = 'shrink-0 cursor-pointer rounded text-[12px] text-ink-muted underline-offset-4 hover:text-brand hover:underline disabled:cursor-wait disabled:opacity-50';

/** 每次打开复制一次；输入、关联仓库和扩展选项都只修改弹窗草稿。 */
export function RuleEditDialog({ rule, index, ctx, staticOnly, adding, saveHint, renderOptions, onSave, onClose }: {
  rule: RuleEntry; index: number; ctx: ConvertCtx; staticOnly: boolean; adding: boolean; saveHint: string;
  renderOptions?: (rule: RuleEntry, onChange: (rule: RuleEntry) => void) => ReactNode;
  onSave: (rule: RuleEntry) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(rule));
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string>();
  const [attempted, setAttempted] = useState(false);
  const matcher = draft.matcher;
  const url = matcher.kind === 'ruleset' ? matcher.remote?.url : undefined;
  let error: string | undefined;
  let normalized: Matcher = matcher;
  if (matcher.kind === 'rule') error = ruleInputError(withIpOptions(matcher.rule, draft.options ?? {})) ?? clientOverridesError(matcher.overrides ?? []);
  else if (matcher.remote) {
    try { normalized = { ...matcher, ...remoteRuleMatcher(matcher.remote.url) }; }
    catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  } else if (!matcher.id) error = '请选择规则集';
  const lookupUrl = !error && normalized.kind === 'ruleset' ? normalized.remote?.url : undefined;
  const matches = useRepositoryUrlMatches(lookupUrl ? [lookupUrl] : []);
  const update = (next: RuleEntry) => { setDraft(next); setLinkError(undefined); };
  const link = async (match: RepositoryUrlMatch) => {
    if (!url || !lookupUrl) return;
    setLinking(true); setLinkError(undefined);
    try {
      const next = await resolveRepositoryUrlMatch(lookupUrl, match);
      const current = latestDraft.current;
      if (current.matcher.kind === 'ruleset' && current.matcher.remote?.url === url) setDraft({ ...current, matcher: next });
    } catch (cause) { setLinkError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLinking(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="flex max-h-[85dvh] min-w-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
      <DialogHeader className="shrink-0 border-b border-line-2 px-5 py-4 text-left sm:px-6">
        <DialogTitle className="pr-6 text-[16px] leading-6">{adding ? '添加静态规则' : `编辑第 ${index + 1} 条规则`}</DialogTitle>
        <DialogDescription className="text-[12.5px]">编辑匹配内容，出口在规则列表中选择。</DialogDescription>
      </DialogHeader>
      <form noValidate className="flex min-h-0 min-w-0 flex-col" onSubmit={event => { event.preventDefault(); setAttempted(true); if (!error && !linking) onSave({ ...draft, matcher: normalized }); }}>
        <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6 [&>*]:min-w-0">
          <fieldset disabled={linking} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
            <MatcherEditor directRemote fixedKind={staticOnly} value={matcher} rulesets={ctx.rulesets}
              ruleValue={matcher.kind === 'rule' ? withIpOptions(matcher.rule, draft.options ?? {}) : undefined}
              onRuleChange={rule => {
                if (matcher.kind !== 'rule') return;
                const { noResolve: _noResolve, src: _src, ...options } = draft.options ?? {};
                update({ ...draft, matcher: { ...matcher, rule }, ...(draft.options ? { options } : {}) });
              }} onChange={matcher => update({ ...draft, matcher })} />
            {lookupUrl && matches.matches[lookupUrl]?.map(match => <button key={`${match.repo}:${match.ref}:${match.path}`} type="button" className={`${repositoryHintClass} self-start text-left`} title={match.hint} onClick={() => void link(match)}>关联仓库文件</button>)}
            {renderOptions && <div className="min-w-0 border-t border-line-2 pt-4">{renderOptions(draft, update)}</div>}
          </fieldset>
          <ErrorAlert error={matches.error} />
          <FieldError error={linkError ?? (attempted ? error : undefined)} />
        </div>
        <DialogFooter className="shrink-0 flex-row flex-wrap items-center justify-end border-t border-line-2 bg-ground px-5 py-3 sm:px-6">
          <span className="mr-auto basis-full text-[12px] text-ink-muted sm:basis-auto">{saveHint}</span>
          <Button onClick={onClose}>取消</Button><Button type="submit" variant="primary" disabled={linking}>{linking ? '关联中…' : '保存'}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
