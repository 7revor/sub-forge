// 用户管理（SYS-01，管理员）：创建、禁用、改角色、重置密码、脚本编写权限。

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { api, type User } from '../api.ts';
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Select, Switch, formatTime, td, th } from '../components/ui.tsx';
import { useMe } from '../hooks.ts';

export function Users() {
  const me = useMe().data;
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<{ users: User[] }>('GET', '/users').then((r) => r.users) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });
  const patch = useMutation({ mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api('PATCH', `/users/${id}`, body), onSuccess: refresh });
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', role: 'user' as User['role'] });
  const create = useMutation({ mutationFn: () => api('POST', '/users', form), onSuccess: () => { setCreating(false); setForm({ username: '', password: '', role: 'user' }); void refresh(); } });
  const [resetting, setResetting] = useState<User>();
  const [newPass, setNewPass] = useState('');

  return (
    <>
      <PageHeader title="用户" actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus size={16} />创建用户</Button>} />
      <p className="m-0 -mt-2 text-[13.5px] text-muted">用户之间数据隔离。禁用用户或重置密码会让其所有登录立即失效。</p>
      <ErrorBox error={users.error ?? patch.error} />
      <Card bodyClass="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse">
          <thead><tr><th className={th}>用户</th><th className={th}>角色</th><th className={th}>创建时间</th><th className={th}>脚本编写权限</th><th className={th}>状态</th><th className={th} /></tr></thead>
          <tbody>
            {(users.data ?? []).map((u) => {
              const self = u.id === me?.id;
              return (
                <tr key={u.id} className={u.disabled ? 'opacity-60' : ''}>
                  <td className={`${td} font-medium`}>{u.username}{self && <span className="ml-2 text-[12px] font-normal text-muted">（我）</span>}</td>
                  <td className={td}>
                    <Select aria-label={`${u.username} 的角色`} className="h-9 w-28" value={u.role} disabled={self} onChange={(e) => patch.mutate({ id: u.id, body: { role: e.target.value } })}>
                      <option value="user">用户</option><option value="admin">管理员</option>
                    </Select>
                  </td>
                  <td className={`${td} text-muted`}>{formatTime(u.createdAt)}</td>
                  <td className={td}>{u.role === 'admin' ? <span className="text-[12.5px] text-muted">管理员默认可写</span> : <Switch label={`${u.username} 的脚本编写权限`} checked={u.scriptAllowed} onChange={(v) => patch.mutate({ id: u.id, body: { scriptAllowed: v } })} />}</td>
                  <td className={td}><Badge tone={u.disabled ? 'neutral' : 'ok'}>{u.disabled ? '已禁用' : '正常'}</Badge></td>
                  <td className={td}>
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" onClick={() => { setResetting(u); setNewPass(''); }}>重置密码</Button>
                      {!self && <Button size="sm" variant={u.disabled ? 'default' : 'danger'} onClick={() => patch.mutate({ id: u.id, body: { disabled: !u.disabled } })}>{u.disabled ? '启用' : '禁用'}</Button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Modal title="创建用户" open={creating} onClose={() => setCreating(false)}
        footer={<><Button onClick={() => setCreating(false)}>取消</Button><Button variant="primary" disabled={create.isPending} onClick={() => create.mutate()}>创建</Button></>}>
        <Field label="用户名" hint="2–32 位字母、数字或 _ . -">{(id) => <Input id={id} autoComplete="off" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />}</Field>
        <Field label="初始密码" hint="至少 8 位">{(id) => <Input id={id} type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}</Field>
        <Field label="角色">{(id) => <Select id={id} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as User['role'] })}><option value="user">用户</option><option value="admin">管理员</option></Select>}</Field>
        <ErrorBox error={create.error} />
      </Modal>

      <Modal title={`重置 ${resetting?.username ?? ''} 的密码`} open={!!resetting} onClose={() => setResetting(undefined)}
        footer={<><Button onClick={() => setResetting(undefined)}>取消</Button><Button variant="primary" disabled={newPass.length < 8 || patch.isPending} onClick={() => resetting && patch.mutate({ id: resetting.id, body: { password: newPass } }, { onSuccess: () => setResetting(undefined) })}>重置</Button></>}>
        <Field label="新密码" hint="至少 8 位；该用户的所有登录会失效">{(id) => <Input id={id} type="password" autoComplete="new-password" value={newPass} onChange={(e) => setNewPass(e.target.value)} />}</Field>
      </Modal>
    </>
  );
}
