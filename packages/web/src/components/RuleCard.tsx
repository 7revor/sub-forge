import type { ReactNode } from 'react';
import { CornerDownRight, FileText, FolderGit2, Globe, Layers, LockKeyhole, type LucideIcon } from 'lucide-react';
import { RoutingCard, RoutingCardActions, RoutingCardIcon, routingControlClass } from './RoutingCard.tsx';
import type { RulePreviewLink } from '../domain/rulePreview.ts';

const layoutClass = 'grid grid-cols-[20px_minmax(0,1fr)_64px] sm:flex sm:flex-wrap';
const contentClass = 'flex min-w-0 items-center gap-3 text-left sm:flex-[1_1_160px]';

export type RuleKind = 'repository' | 'collection' | 'remote' | 'local';
const RULE_KINDS: Record<RuleKind, { label: string; icon: LucideIcon }> = {
  repository: { label: '规则仓库', icon: FolderGit2 },
  collection: { label: '规则集合', icon: Layers },
  remote: { label: '远程地址', icon: Globe },
  local: { label: '本地规则', icon: FileText },
};

/** 图标与定宽类型列让名称在所有类型下左对齐，靠类型列而不是字体区分。 */
function RuleHead({ icon, type, muted, children }: { icon: ReactNode; type: string; muted?: boolean; children: ReactNode }) {
  return <><RoutingCardIcon muted={muted}>{icon}</RoutingCardIcon><span className="w-12 shrink-0 text-xs text-muted-foreground">{type}</span><span className="min-w-0 truncate font-medium">{children}</span></>;
}

/** 规则增强、模板与订阅共用：正文预览，铅笔编辑，操作不会触发预览。 */
export function RuleCard({ handle, kind, children, count, hint, target, readOnly, invalid, previewLinks = [], previewHint, externalPreview, onPreview, onEdit, onDelete, label, id }: {
  handle: ReactNode; kind: RuleKind; children: ReactNode; count?: ReactNode; hint?: ReactNode; target?: ReactNode;
  readOnly?: boolean; invalid?: boolean; previewLinks?: RulePreviewLink[]; previewHint?: string; externalPreview?: boolean; onPreview: () => void; onEdit: () => void; onDelete: () => void; label: string; id?: string;
}) {
  const { label: type, icon: Icon } = RULE_KINDS[kind];
  return <RoutingCard id={id} invalid={invalid} className={layoutClass}>
    {handle}
    {externalPreview ? <div className={`${contentClass} flex-col items-stretch`}>
      {(previewLinks.length ? previewLinks : [{ href: undefined, label: undefined, title: undefined }]).map((link, index) => <a key={index} href={link.href} target="_blank" rel="noreferrer noopener"
        aria-label={`打开${label}的文件${previewLinks.length > 1 ? ` ${index + 1}` : ''}`} aria-disabled={!link.href}
        title={link.href ? link.title ?? '在新标签页查看源文件' : previewHint ?? '请填写有效的源文件地址'} className="flex min-w-0 cursor-pointer items-center gap-3 rounded-lg no-underline">
        <RuleHead icon={<Icon />} type={type} muted={readOnly}>{previewLinks.length > 1 ? link.label : children}</RuleHead>
      </a>)}
    </div> : <button type="button" aria-label={`预览${label}`} onClick={onPreview} className={`cursor-pointer rounded-lg ${contentClass}`}>
      <RuleHead icon={<Icon />} type={type} muted={readOnly}>{children}</RuleHead>
    </button>}
    <div className="col-span-2 col-start-2 row-start-2 flex min-w-0 items-center justify-end gap-2 empty:hidden sm:contents">
      {hint}{count}
      {target && <div className={routingControlClass}>{target}</div>}
    </div>
    {!readOnly && <div className="col-start-3 row-start-1 ml-auto w-16 shrink-0"><RoutingCardActions label={label} onEdit={onEdit} onDelete={onDelete} /></div>}
    {readOnly && <span className="col-start-3 row-start-1 w-16 shrink-0 text-right text-xs text-muted-foreground" aria-label="来自模板"><LockKeyhole size={14} className="ml-auto" /></span>}
  </RoutingCard>;
}

/** MATCH 固定在排序列表之后，共用规则卡片尺寸，仅允许修改出口。 */
export function RuleFinalCard({ target, targetId, readOnly }: { target: ReactNode; targetId: string; readOnly?: boolean }) {
  return <RoutingCard className={layoutClass}>
    <span role="img" aria-label="MATCH 固定在末尾" title="固定在末尾" className="grid h-8 w-5 shrink-0 place-items-center text-muted-foreground"><LockKeyhole size={16} /></span>
    <div className={contentClass}><RuleHead icon={<CornerDownRight />} type="MATCH">其余流量</RuleHead></div>
    <div className="col-span-2 col-start-2 row-start-2 flex min-w-0 justify-end sm:contents"><div id={targetId} className={routingControlClass}>{target}</div></div>
    {readOnly ? <span className="col-start-3 row-start-1 w-16 shrink-0 text-right text-xs text-muted-foreground" aria-label="来自模板"><LockKeyhole size={14} className="ml-auto" /></span> : <span className="col-start-3 row-start-1 w-16 shrink-0" aria-hidden />}
  </RoutingCard>;
}
