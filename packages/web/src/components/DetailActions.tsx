// 操作按钮只调用唯一弹窗入口，不持有可见状态或挂载弹窗。
import { Frame } from '../modals/Frame.tsx';
import { Button } from './ui.tsx';
export type ActionItem = { label: string; onSelect: () => void };
export function ActionButtons({ items }: { items: ActionItem[] }) {
  return <>{items.map(item => <Button key={item.label} onClick={item.onSelect}>{item.label}</Button>)}</>;
}
export function DeleteAction({ what, name, body, pending, onDelete, onReset }: {
  what: string; name: string; body?: string; error?: unknown; pending?: boolean; onDelete: () => Promise<unknown> | void; onReset?: () => void;
}) {
  return <Button variant="danger" disabled={pending} onClick={() => { onReset?.(); void Frame.modal.confirm({ title: `删除${what}「${name}」？`, description: body ?? '删除后无法恢复。', confirmLabel: '删除', danger: true }, { submit: async () => { await onDelete(); } }); }}>删除</Button>;
}
