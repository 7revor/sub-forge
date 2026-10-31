import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { PageScroll, cx } from '../../components/ui.tsx';
import { TabBase, TabNodeSets, TabProfileInfo } from './TabsBasic.tsx';
import { TabChains, TabPreview } from './TabsChain.tsx';
import { TabGroups } from './TabGroups.tsx';
import { TabRules } from './TabRules.tsx';
import { Report, resolveProfileRouting, routingConfig } from '@sub-forge/core';
import { useProfile } from './context.ts';
import { TemplateCard } from './TemplateCard.tsx';

const TABS = [['nodes', '节点'], ['routing', '分流'], ['client', '客户端配置'], ['preview', '预览']] as const;
const sectionTab = (section?: string) => section === 'preview' ? 'preview' : ['base', 'basic', 'client'].includes(section ?? '') ? 'client' : ['template', 'groups', 'rules', 'routing'].includes(section ?? '') ? 'routing' : 'nodes';

/** 基础与核心面板保持挂载，切换时保留草稿、展开状态和未解析的 YAML。 */
export function ProfileSections({ initialSection, routingReady = true, templateNotice, disabled = false, children }: { initialSection?: string; routingReady?: boolean; templateNotice?: ReactNode; disabled?: boolean; children?: ReactNode }) {
  const id = useId();
  const { draft, template, groups } = useProfile();
  const ruleCount = routingConfig(resolveProfileRouting(draft, template, new Report())).rules.length;
  const [active, setActive] = useState(sectionTab(initialSection));
  const sections = useRef<Record<string, HTMLElement | null>>({});
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    setActive(sectionTab(initialSection));
    if (initialSection && !['overview', 'basic', 'core'].includes(initialSection)) {
      const frame = requestAnimationFrame(() => sections.current[initialSection]?.scrollIntoView({ block: 'start' }));
      return () => cancelAnimationFrame(frame);
    }
  }, [initialSection]);
  return <>
    <div role="tablist" aria-label="订阅设置" className="flex shrink-0 gap-6 border-b border-line bg-ground">
      {TABS.map(([key, label], index) => <button key={key} ref={el => { tabs.current[index] = el; }} type="button" disabled={disabled} role="tab" id={`${id}-${key}-tab`} aria-controls={`${id}-${key}-panel`} aria-selected={active === key} tabIndex={active === key ? 0 : -1}
        className={cx('flex h-11 items-center border-b-2 text-[length:var(--text-body)] outline-offset-4 transition-colors', active === key ? 'border-brand font-semibold text-ink' : 'border-transparent text-ink-muted hover:text-ink')}
        onClick={() => setActive(key)} onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
          setActive(TABS[next]![0]); tabs.current[next]?.focus();
        }}>{label}{key === 'nodes' && <span className="ml-1.5 text-[length:var(--text-caption)] font-normal text-ink-muted">{draft.nodeSets.length}</span>}{key === 'routing' && <span className="ml-1.5 text-[length:var(--text-caption)] font-normal text-ink-muted">{groups.length} 组 · {ruleCount} 规则</span>}</button>)}
    </div>
    <PageScroll contained={active === 'preview'}>
      <fieldset disabled={disabled} className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0">
        <div role="tabpanel" id={`${id}-nodes-panel`} aria-labelledby={`${id}-nodes-tab`} hidden={active !== 'nodes'} className={active === 'nodes' ? 'flex min-w-0 flex-col gap-5' : undefined}>
          <section ref={el => { sections.current.nodesets = el; }} className="scroll-mt-1"><TabNodeSets /></section>
          <section ref={el => { sections.current.chains = el; }} className="flex scroll-mt-1 flex-col gap-4"><TabChains /></section>
        </div>
        <div role="tabpanel" id={`${id}-routing-panel`} aria-labelledby={`${id}-routing-tab`} hidden={active !== 'routing'} className={active === 'routing' ? 'flex min-w-0 flex-col gap-5' : undefined}>
          <section ref={el => { sections.current.template = el; }} className="scroll-mt-1"><TemplateCard />{templateNotice}</section>
          {routingReady && <>
            <section ref={el => { sections.current.groups = el; }} className="flex scroll-mt-1 flex-col gap-4"><TabGroups /></section>
            <section ref={el => { sections.current.rules = el; }} className="flex scroll-mt-1 flex-col gap-4"><TabRules /></section>
          </>}
        </div>
        <div role="tabpanel" id={`${id}-client-panel`} aria-labelledby={`${id}-client-tab`} hidden={active !== 'client'} className={active === 'client' ? 'flex min-w-0 flex-col gap-5' : undefined}>
          <section ref={el => { sections.current.base = el; }} className="flex scroll-mt-1 flex-col gap-4"><TabBase /></section>
        </div>
        <div role="tabpanel" id={`${id}-preview-panel`} aria-labelledby={`${id}-preview-tab`} hidden={active !== 'preview'} className={active === 'preview' ? 'flex min-h-0 min-w-0 flex-1 flex-col gap-5' : undefined}>
          {active === 'preview' && <TabPreview />}
        </div>
        {children}
      </fieldset>
    </PageScroll>
  </>;
}
