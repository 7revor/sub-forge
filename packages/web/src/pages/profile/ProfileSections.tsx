import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../../components/ui.tsx';
import { TabBase, TabNodeSets } from './TabsBasic.tsx';
import { TabChains, TabPreview } from './TabsChain.tsx';
import { TabGroups } from './TabGroups.tsx';
import { TabRules } from './TabRules.tsx';

const SECTIONS = [['nodesets', '节点集'], ['chains', '代理链'], ['groups', '策略组'], ['rules', '规则'], ['base', '基础设置'], ['preview', '预览配置']] as const;
/** 新建、编辑共用连续页面，导航只滚动定位，不卸载编辑内容。 */
export function ProfileSections({ initialSection, routingReady = true, before, overview }: { initialSection?: string; routingReady?: boolean; before?: ReactNode; overview?: ReactNode }) {
  const sections = useRef<Record<string, HTMLElement | null>>({});
  const [baseOpen, setBaseOpen] = useState(initialSection === 'base');
  const [previewOpen, setPreviewOpen] = useState(initialSection === 'preview');
  const jump = (key: string) => {
    if (key === 'base') setBaseOpen(true);
    if (key === 'preview') setPreviewOpen(true);
    requestAnimationFrame(() => sections.current[key]?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  };
  useEffect(() => { if (initialSection && initialSection !== 'overview') jump(initialSection); }, [initialSection]);
  return <>
    <nav aria-label="订阅页内导航" className="sticky top-0 z-10 -mt-1 flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-ground py-2">
      {SECTIONS.map(([key, label]) => <Button key={key} variant="ghost" size="sm" className="shrink-0" onClick={() => jump(key)}>{label}</Button>)}
      {overview && <Button variant="ghost" size="sm" className="shrink-0" onClick={() => jump('overview')}>订阅链接</Button>}
    </nav>
    {before}
    <section ref={el => { sections.current.nodesets = el; }} className="scroll-mt-16"><TabNodeSets /></section>
    <section ref={el => { sections.current.chains = el; }} className="flex scroll-mt-16 flex-col gap-4"><TabChains /></section>
    {routingReady && <>
      <section ref={el => { sections.current.groups = el; }} className="flex scroll-mt-16 flex-col gap-4"><TabGroups /></section>
      <section ref={el => { sections.current.rules = el; }} className="flex scroll-mt-16 flex-col gap-4"><TabRules /></section>
    </>}
    <details ref={el => { sections.current.base = el; }} open={baseOpen} onToggle={e => setBaseOpen(e.currentTarget.open)} className="scroll-mt-16 rounded-lg border border-line bg-panel p-4"><summary className="cursor-pointer text-[14px] font-semibold">基础设置</summary><div className="mt-4 flex flex-col gap-4"><TabBase /></div></details>
    <details ref={el => { sections.current.preview = el; }} open={previewOpen} onToggle={e => setPreviewOpen(e.currentTarget.open)} className="scroll-mt-16 rounded-lg border border-line bg-panel p-4"><summary className="cursor-pointer text-[14px] font-semibold">预览配置</summary>{previewOpen && <div className="mt-4 flex flex-col gap-4"><TabPreview /></div>}</details>
    {overview && <section ref={el => { sections.current.overview = el; }} className="flex scroll-mt-16 flex-col gap-4"><h2 className="m-0 text-[15px] font-semibold">订阅链接与输出</h2>{overview}</section>}
  </>;
}
