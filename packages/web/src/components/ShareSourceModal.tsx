import type { QueryClient } from '@tanstack/react-query';
import { api, type Share, type User } from '../api.ts';
import { alertError, notifySuccess } from '../feedback.ts';
import { createModal, useModalDraft, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '../modals/index.tsx';
import { MultiSelect } from './listbox.tsx';
import { Button, Field, Select } from './ui.tsx';

type ShareData = { sources: { id: string; name: string }[]; users: { id: string; username: string }[]; shares: Share[]; sourceId?: string };

/** 用户页和订阅源详情共用；接收者整体保存，清空全部接收者等于取消分享。 */
const ShareSourceModal = createModal<ShareData>(function ShareSourceForm({ data: { sources, users, shares, sourceId }, modal }) {
  const recipients = (id: string) => shares.find((x) => x.id === id)?.to ?? [];
  const [share, setShare] = useModalDraft({ source: sourceId ?? '', to: sourceId ? recipients(sourceId) : [] });
  const unchanged = !share.to.length && !recipients(share.source).length;
  return <ModalContent className="max-h-[85dvh] overflow-y-auto" aria-describedby={undefined}><ModalHeader><ModalTitle>分享订阅源</ModalTitle></ModalHeader><div className="flex min-h-0 flex-col gap-4">
    <Field label="要分享的订阅源">{(id) => <Select clearable={!sourceId} disabled={!!sourceId} placeholder="选择要分享的订阅源" id={id} value={share.source} onChange={(e) => setShare({ source: e.target.value, to: recipients(e.target.value) })}>
      {sources.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
    </Select>}</Field>
    <Field label="分享给">{(id) => <MultiSelect id={id} placeholder="选择可以只读引用的用户（可多选）" value={share.to} onChange={(to) => setShare({ ...share, to })}>{users.map((user) => <option key={user.id} value={user.id}>{user.username}</option>)}</MultiSelect>}</Field>
    <span className="text-xs text-muted-foreground">接收者可以引用和查看节点，看不到地址和处理链，也不能修改。移除接收者后，其引用此订阅源的配置订阅会无法使用。</span>
  </div><ModalFooter><Button onClick={modal.cancel}>取消</Button><Button variant="primary" disabled={!share.source || unchanged || modal.pending} onClick={() => modal.submit(async () => { await api('PUT', `/shares/${share.source}`, { to: share.to }); })}>{modal.pending ? '保存中…' : '保存'}</Button></ModalFooter></ModalContent>;
});

/** 打开前读取最新的用户和分享，避免覆盖其他页面刚保存的接收者。 */
export async function shareSource(qc: QueryClient, meId: string, sources: ShareData['sources'], sourceId?: string): Promise<void> {
  let users: User[], shares: Share[];
  try {
    [users, shares] = await Promise.all([
      api<{ users: User[] }>('GET', '/users').then((r) => r.users),
      api<{ items: Share[] }>('GET', '/shares').then((r) => r.items),
    ]);
  } catch (error) {
    alertError(error instanceof Error ? error.message : String(error));
    return;
  }
  const result = await ShareSourceModal.show({ sources, shares, users: users.filter((u) => u.id !== meId).map(({ id, username }) => ({ id, username })), ...(sourceId ? { sourceId } : {}) });
  if (result.status === 'confirmed') {
    notifySuccess('分享已保存');
    void qc.invalidateQueries({ queryKey: ['shares'] });
  }
}
