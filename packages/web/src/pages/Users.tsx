import { ActionMenu } from '../components/ActionMenu.tsx';
import { Frame } from '../modals/Frame.tsx';
import { createModal, useModalDraft, ModalContent, ModalHeader, ModalTitle, ModalFooter } from '../modals/index.tsx';
import { formatRelativeTime } from '../utils/format.ts';
// 用户管理（SYS-01，管理员）：创建、禁用、改角色、重置密码、脚本编写权限。

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { notifySuccess } from '../feedback.ts';
import { api, type Share, type User, type UserStats } from '../api.ts';
import { shareSource } from '../components/ShareSourceModal.tsx';
import { Badge, BooleanSegmented, Button, Card, Empty, ErrorAlert, Field, Input, PageHeader, PageScroll, Select, Segmented, Switch, listMono } from '../components/ui.tsx';
import { useList, useMe } from '../hooks.ts';
import { ListActions } from '../components/ListActions.tsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table.tsx';

/** 用户（设计稿「管理员 · 用户」）：用户表与分享的订阅源 */
export function Users() {
  const me = useMe().data;
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<{ users: User[] }>('GET', '/users').then((r) => r.users) });
  const stats = useQuery({ queryKey: ['users', 'stats'], queryFn: () => api<UserStats>('GET', '/users/stats') });
  const shares = useQuery({ queryKey: ['shares'], queryFn: () => api<{ items: Share[] }>('GET', '/shares').then((r) => r.items) });
  const sources = useList('sources');
  const ownSources = (sources.data ?? []).filter((s) => !s.sharedBy).map((s) => ({ id: s.id, name: s.name }));
  const revokeShare = async (share: Share) => {
    const result = await Frame.modal.confirm({ title: `取消分享「${share.name}」？`, description: '接收者立即失去访问权限；引用它的配置订阅会无法使用，直到移除这个节点来源。', confirmLabel: '取消分享', danger: true }, { submit: async () => { await api('PUT', `/shares/${share.id}`, { to: [] }); } });
    if (result.status === 'confirmed') { notifySuccess('已取消分享'); void qc.invalidateQueries({ queryKey: ['shares'] }); }
  };
  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });
  const patch = useMutation({ meta: { successMessage: '用户已更新' }, mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api('PATCH', `/users/${id}`, body), onSuccess: refresh });
  const st = (id: string) => stats.data?.items[id];
  const list = users.data ?? [];
  const nameOf = (id: string) => list.find((u) => u.id === id)?.username ?? id;

  return (
    <>
      <PageHeader title="用户" subtitle={`${list.length} 个用户`}
        actions={<Button variant="primary" onClick={async () => { const result = await CreateUserModal.show({}); if (result.status === 'confirmed') { notifySuccess('用户已创建'); void refresh(); } }}><Plus size={16} />创建用户</Button>} />
      <ErrorAlert error={users.error ?? patch.error} />
      <PageScroll>
        <Card className="overflow-hidden" bodyClass="">
          <Table className="min-w-[760px]">
            <TableHeader><TableRow><TableHead>用户</TableHead><TableHead>角色</TableHead><TableHead>脚本处理器</TableHead><TableHead>配置订阅</TableHead><TableHead>最近订阅请求</TableHead><TableHead>状态</TableHead><TableHead className="w-px"><span className="sr-only">操作</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {list.map((u) => {
                const self = u.id === me?.id;
                const s = st(u.id);
                return (
                  <TableRow key={u.id} className={u.disabled ? 'opacity-60' : ''}>
                    <TableCell className="font-medium whitespace-nowrap">{u.username}{self && <span className="ml-2 text-xs font-normal text-muted-foreground">（我）</span>}</TableCell>
                    <TableCell>
                      {self ? <span>管理员</span> : <Select placeholder="选择用户的权限角色" aria-label={`${u.username} 的角色`} size="sm" className="w-28" value={u.role} disabled={self} onChange={(e) => patch.mutate({ id: u.id, body: { role: e.target.value } })}>
                        <option value="user">用户</option><option value="admin">管理员</option>
                      </Select>}
                    </TableCell>
                    <TableCell>{u.role === 'admin' ? <span className="text-sm text-muted-foreground">管理员默认可写</span> : <BooleanSegmented label={`${u.username} 的脚本编写权限`} on="允许" off="禁止" value={u.scriptAllowed} onChange={(v) => patch.mutate({ id: u.id, body: { scriptAllowed: v } })} />}</TableCell>
                    <TableCell className={listMono}>{s?.profiles ?? '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-foreground">{s?.lastRequestAt ? formatRelativeTime(s.lastRequestAt, { justNow: false }) : '—'}</TableCell>

                    <TableCell><Badge tone={u.disabled ? 'neutral' : 'ok'}>{u.disabled ? '已禁用' : '正常'}</Badge></TableCell>
                    <TableCell>
                      <ListActions><ActionMenu label={`${u.username}更多操作`}>
                        <Button size="sm" onClick={async () => { const result = await Frame.modal.prompt({ title: `重置 ${u.username} 的密码`, label: '新密码', description: '至少 8 位；该用户的所有登录会失效', placeholder: '设置至少 8 位的新密码', type: 'password', minLength: 8, confirmLabel: '重置' }, { submit: async password => { await api('PATCH', `/users/${u.id}`, { password }); } }); if (result.status === 'confirmed') { notifySuccess('密码已重置'); void refresh(); } }}>重置密码</Button>
                        {!self && <Button size="sm" variant={u.disabled ? 'default' : 'danger'} onClick={() => patch.mutate({ id: u.id, body: { disabled: !u.disabled } })}>{u.disabled ? '启用' : '禁用'}</Button>}
                      </ActionMenu></ListActions>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>

        <Card title="分享的订阅源" subtitle="接收者只读，可以引用和查看节点，看不到地址和处理链。"
          actions={<Button disabled={!me} onClick={() => void shareSource(qc, me!.id, ownSources)}>分享订阅源</Button>}>
          <ErrorAlert error={shares.error} />
          <div className="flex flex-col">
            {(shares.data ?? []).map((x) => (
              <div key={x.id} className="flex flex-wrap items-center gap-3 border-t border-border py-2.5 first:border-0">
                <span className="text-sm font-medium">{x.name}</span>
                <span className="min-w-0 flex-1 text-sm text-muted-foreground">分享给：{x.to.map(nameOf).join('、')}</span>
                <Button size="sm" onClick={() => void shareSource(qc, me!.id, ownSources, x.id)}>修改</Button>
                <Button size="sm" variant="danger" onClick={() => void revokeShare(x)}>取消分享</Button>
              </div>
            ))}
            {shares.data && !shares.data.length && <Empty title="还没有分享" />}
          </div>
        </Card>

      </PageScroll>

    </>
  );
}

const CreateUserModal = createModal<Record<string, never>>(function CreateUser({ modal }) {
  const [form, setForm] = useModalDraft({ username: '', password: '', role: 'user' as User['role'], scriptAllowed: false });
  return <ModalContent className="max-h-[85dvh] overflow-y-auto" aria-describedby={undefined}><ModalHeader><ModalTitle>{"创建用户"}</ModalTitle></ModalHeader><div className="flex min-h-0 flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="用户名">{(id) => <Input placeholder="填写 2–32 位字母、数字或 _ . -" id={id} autoComplete="off" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />}</Field>
          <Field label="角色">{id => <div id={id}><Segmented label="用户角色" value={form.role} options={[{ value: 'user', label: '普通用户' }, { value: 'admin', label: '管理员' }]} onChange={role => setForm({ ...form, role })} /></div>}</Field>
          <Field label="初始密码" className="col-span-2">{(id) => <Input placeholder="设置至少 8 位的初始密码" id={id} type="password" autoComplete="new-password" className="font-mono" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}</Field>
        </div>
        {form.role !== 'admin' && <label className="flex items-center gap-2 text-sm"><Switch label="允许编写脚本处理器" checked={form.scriptAllowed} onChange={scriptAllowed => setForm({ ...form, scriptAllowed })} />允许编写脚本处理器</label>}

      </div><ModalFooter>{<><Button onClick={modal.cancel}>取消</Button><Button variant="primary" disabled={modal.pending} onClick={() => modal.submit(async () => { await api('POST', '/users', { ...form, scriptAllowed: form.role !== 'admin' && form.scriptAllowed }); })}>{modal.pending ? '创建中…' : '创建'}</Button></>}</ModalFooter></ModalContent>;
});
