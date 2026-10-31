import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Frame } from '../modals/Frame.tsx';
import { CopyButton } from '../components/CopyButton.tsx';
import { api } from '../api.ts';
import { Button, Card, ErrorAlert, Field, Input, PageHeader, PageScroll } from '../components/ui.tsx';
import { useMe } from '../hooks.ts';

export function Account() {
  const me = useMe().data;
  const qc = useQueryClient();
  const token = useQuery({ queryKey: ['user-token'], queryFn: () => api<{ item: { token: string } }>('GET', '/me/token').then(r => r.item.token) });
  const resetToken = async () => {
    if (!token.data) return;
    const expected = token.data;
    await Frame.modal.confirm({ title: '重置访问令牌？', description: '你所有配置订阅、节点和规则下载的旧链接都会立即失效。重置后需要重新复制订阅链接到各个客户端。', confirmLabel: '重置全部链接', danger: true }, { submit: async () => {
      const result = await api<{ item: { token: string } }>('POST', '/me/token/reset', { token: expected });
      qc.setQueryData(['user-token'], result.item.token);
      await qc.invalidateQueries({ queryKey: ['subscription-link'] });
      await qc.invalidateQueries({ queryKey: ['resource-link'] });
    } });
  };
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const change = useMutation({ meta: { successMessage: '密码已更新，其他设备需要重新登录' }, mutationFn: () => api('POST', '/me/password', { current, next }) });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return;
    change.mutate(undefined, { onSuccess: () => { setCurrent(''); setNext(''); setConfirm(''); } });
  };

  const scripts = me?.role === 'admin' || me?.scriptAllowed;
  return <>
    <PageHeader title="账户" />
    <PageScroll><section className="settings-panel">
      <div className="settings-row"><div><h2>{me?.username}</h2><p>{me?.role === 'admin' ? '管理员' : '普通用户'} · {scripts ? '脚本处理器可写' : '未授权脚本处理器'}</p></div></div>
      <div className="settings-row"><div><h2>资源访问令牌</h2><p>所有订阅链接共用；重置后旧链接立即失效</p></div>
        <div className="flex flex-col gap-3"><ErrorAlert error={token.error} /><div className="flex flex-wrap items-center gap-2"><span className="flex h-9 w-[280px] items-center rounded-lg border border-control-line bg-inset px-3 font-mono text-[length:var(--text-control)]">{token.data ? `${token.data.slice(0, 4)}••••••••••••${token.data.slice(-4)}` : '正在读取…'}</span><CopyButton text={token.data ?? ''} disabled={!token.data}>复制</CopyButton><Button variant="danger" disabled={!token.data} onClick={() => void resetToken()}>重置令牌…</Button></div></div>
      </div>
      <div className="settings-row"><div><h2>密码</h2><p>修改后其他设备需要重新登录</p></div>
        <form onSubmit={submit} className="grid max-w-[720px] grid-cols-1 items-start gap-4 sm:grid-cols-3">
          <Field label="当前密码">{id => <Input placeholder="输入当前登录密码" id={id} type="password" autoComplete="current-password" value={current} onChange={event => setCurrent(event.target.value)} required />}</Field>
          <Field label="新密码">{id => <Input placeholder="设置至少 8 位的新密码" id={id} type="password" autoComplete="new-password" minLength={8} value={next} onChange={event => setNext(event.target.value)} required />}</Field>
          <Field label="确认新密码" hint={confirm && confirm !== next ? '两次输入不一致' : undefined}>{id => <Input placeholder="再次输入新密码以确认" id={id} type="password" autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} required />}</Field>
          <div className="sm:col-span-3"><ErrorAlert error={change.error} /><Button type="submit" disabled={change.isPending || !next || next !== confirm}>{change.isPending ? '更新中…' : '更新密码'}</Button></div>
        </form>
      </div>
    </section></PageScroll>
  </>;
}
