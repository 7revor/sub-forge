// 用户管理（SYS-01，管理员）：创建、禁用、改角色、重置密码、脚本编写权限。

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { api, type Pending, type Share, type User, type UserStats } from '../api.ts';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, PageScroll, PendingNotice, Select, Switch, formatTime, td, th, cx } from '../components/ui.tsx';
import { useList, useMe } from '../hooks.ts';

function ago(ms: number): string {
  const d = Date.now() - ms;
  if (d < 3_600_000) return `${Math.max(1, Math.floor(d / 60_000))} 分钟前`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} 小时前`;
  return formatTime(ms).slice(5);
}

/** 用户（设计稿「管理员 · 用户」）：用户表与共享的订阅源 / 组合 */
export function Users() {
  const me = useMe().data;
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<{ users: User[] }>('GET', '/users').then((r) => r.users) });
  const stats = useQuery({ queryKey: ['users', 'stats'], queryFn: () => api<UserStats>('GET', '/users/stats') });
  const shares = useQuery({ queryKey: ['shares'], queryFn: () => api<Pending & { items: Share[] }>('GET', '/shares') });
  const sources = useList('sources');
  const collections = useList('collections');
  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });
  const patch = useMutation({ mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api('PATCH', `/users/${id}`, body), onSuccess: refresh });
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', role: 'user' as User['role'], scriptAllowed: false });
  const create = useMutation({
    mutationFn: async () => {
      const { user } = await api<{ user: User }>('POST', '/users', { username: form.username, password: form.password, role: form.role });
      if (form.scriptAllowed && form.role !== 'admin') await api('PATCH', `/users/${user.id}`, { scriptAllowed: true });
    },
    onSuccess: () => { setCreating(false); setForm({ username: '', password: '', role: 'user', scriptAllowed: false }); void refresh(); },
  });
  const [resetting, setResetting] = useState<User>();
  const [newPass, setNewPass] = useState('');
  const [sharing, setSharing] = useState(false);
  const [share, setShare] = useState<{ doc: string; to: string[] }>({ doc: '', to: [] });
  const addShare = useMutation({
    mutationFn: () => { const [kind, docId] = share.doc.split(':'); return api('POST', '/shares', { kind, id: docId, to: share.to }); },
    onSuccess: () => { setSharing(false); void qc.invalidateQueries({ queryKey: ['shares'] }); },
  });
  const st = (id: string) => stats.data?.items[id];
  const list = users.data ?? [];
  const nameOf = (id: string) => list.find((u) => u.id === id)?.username ?? id;

  return (
    <>
      <PageHeader title="用户" subtitle={`${list.length} 个用户。用户之间数据隔离；禁用或重置密码会让其所有登录立即失效。`}
        actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus size={16} />创建用户</Button>} />
      <ErrorBox error={users.error ?? patch.error} />
      <PageScroll>
        <Card bodyClass="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse">
            <thead><tr><th className={th}>用户</th><th className={th}>角色</th><th className={th}>配置订阅</th><th className={th}>订阅源</th><th className={th}>最近订阅请求</th><th className={th}>脚本编写权限</th><th className={th}>状态</th><th className={cx(th, 'w-px')}><span className="sr-only">操作</span></th></tr></thead>
            <tbody>
              {list.map((u) => {
                const self = u.id === me?.id;
                const s = st(u.id);
                return (
                  <tr key={u.id} className={u.disabled ? 'opacity-60' : ''}>
                    <td className={cx(td, 'font-medium whitespace-nowrap')}>{u.username}{self && <span className="ml-2 text-[12px] font-normal text-muted">（我）</span>}</td>
                    <td className={td}>
                      <Select aria-label={`${u.username} 的角色`} className="h-9 w-28" value={u.role} disabled={self} onChange={(e) => patch.mutate({ id: u.id, body: { role: e.target.value } })}>
                        <option value="user">用户</option><option value="admin">管理员</option>
                      </Select>
                    </td>
                    <td className={cx(td, 'font-mono')}>{s?.profiles ?? '—'}</td>
                    <td className={cx(td, 'font-mono')}>{s?.sources ?? '—'}</td>
                    <td className={cx(td, 'whitespace-nowrap text-ink-2')}>{s?.lastRequestAt ? ago(s.lastRequestAt) : '—'}</td>
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
          {stats.data?.pending && <p className="mx-4 my-3 text-[12px] text-muted">配置订阅、订阅源与最近订阅请求的统计还没有接入服务端，暂时显示为「—」。</p>}
        </Card>

        <Card title={`共享的订阅源与组合`} subtitle={`被共享的用户只能引用，看不到原始 URL。`}
          actions={<Button onClick={() => { setShare({ doc: '', to: [] }); setSharing(true); }}>共享…</Button>}>
          {shares.data?.pending && <div className="mb-3"><PendingNotice>共享模型还没有接入，「共享…」会被拒绝。</PendingNotice></div>}
          <div className="flex flex-col">
            {(shares.data?.items ?? []).map((x) => (
              <div key={x.id} className="flex flex-wrap items-center gap-3 border-t border-line-2 py-2.5 first:border-0">
                <span className="text-[13.5px] font-medium">{x.name}</span><Badge>{x.kind === 'source' ? '订阅源' : '组合'}</Badge>
                <span className="text-[12.5px] text-muted">共享给：{x.to.map(nameOf).join('、') || '—'}</span>
              </div>
            ))}
            {!shares.data?.items.length && <Empty title="还没有共享" />}
          </div>
        </Card>

      </PageScroll>
      <Modal title="创建用户" open={creating} onClose={() => setCreating(false)}
        footer={<><Button onClick={() => setCreating(false)}>取消</Button><Button variant="primary" disabled={create.isPending} onClick={() => create.mutate()}>{create.isPending ? '创建中…' : '创建'}</Button></>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="用户名" hint="2–32 位字母、数字或 _ . -">{(id) => <Input id={id} autoComplete="off" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />}</Field>
          <Field label="角色">{(id) => <Select id={id} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as User['role'] })}><option value="user">普通用户</option><option value="admin">管理员</option></Select>}</Field>
          <Field label="初始密码（至少 8 位）" className="col-span-2">{(id) => <Input id={id} type="password" autoComplete="new-password" className="font-mono" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}</Field>
        </div>
        {form.role !== 'admin' && <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={form.scriptAllowed} onChange={(e) => setForm({ ...form, scriptAllowed: e.target.checked })} />允许编写脚本处理器</label>}
        <ErrorBox error={create.error} />
      </Modal>

      <Modal title={`重置 ${resetting?.username ?? ''} 的密码`} open={!!resetting} onClose={() => setResetting(undefined)}
        footer={<><Button onClick={() => setResetting(undefined)}>取消</Button><Button variant="primary" disabled={newPass.length < 8 || patch.isPending} onClick={() => resetting && patch.mutate({ id: resetting.id, body: { password: newPass } }, { onSuccess: () => setResetting(undefined) })}>重置</Button></>}>
        <Field label="新密码" hint="至少 8 位；该用户的所有登录会失效">{(id) => <Input id={id} type="password" autoComplete="new-password" value={newPass} onChange={(e) => setNewPass(e.target.value)} />}</Field>
      </Modal>

      <Modal title="共享订阅源或组合" open={sharing} onClose={() => setSharing(false)}
        footer={<><Button onClick={() => setSharing(false)}>取消</Button><Button variant="primary" disabled={!share.doc || !share.to.length || addShare.isPending} onClick={() => addShare.mutate()}>共享</Button></>}>
        <Field label="要共享的订阅源或组合">{(id) => <Select id={id} value={share.doc} onChange={(e) => setShare({ ...share, doc: e.target.value })}>
          <option value="">选择</option>
          {(sources.data ?? []).map((x) => <option key={x.id} value={`source:${x.id}`}>订阅源 · {x.name}</option>)}
          {(collections.data ?? []).map((x) => <option key={x.id} value={`collection:${x.id}`}>组合 · {x.name}</option>)}
        </Select>}</Field>
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1.5 text-[12.5px] font-medium text-muted">共享给</legend>
          {list.filter((u) => u.id !== me?.id).map((u) => <label key={u.id} className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={share.to.includes(u.id)} onChange={(e) => setShare({ ...share, to: e.target.checked ? [...share.to, u.id] : share.to.filter((x) => x !== u.id) })} />{u.username}</label>)}
        </fieldset>
        <span className="text-[12px] text-muted">被共享的用户只能在节点集里引用，看不到原始 URL，也不能修改处理链。</span>
        <ErrorBox error={addShare.error} />
      </Modal>
    </>
  );
}
