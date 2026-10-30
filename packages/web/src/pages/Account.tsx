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

  const kv = 'grid grid-cols-[120px_minmax(0,1fr)] gap-2.5 border-t border-line-2 py-2 text-[13.5px]';
  const scripts = me?.role === 'admin' || me?.scriptAllowed;
  return (
    <>
      <PageHeader title="账户" />
      <PageScroll>
        <div className="flex flex-wrap items-start gap-5">
          <Card title="当前用户" className="min-w-0 flex-[1_1_360px]">
            <div className="flex flex-col">
              <div className={kv}><span className="text-ink-muted">用户名</span><span>{me?.username}</span></div>
              <div className={kv}><span className="text-ink-muted">角色</span><span>{me?.role === 'admin' ? '管理员' : '普通用户'}</span></div>
              <div className={kv}><span className="text-ink-muted">脚本处理器</span><span>{scripts ? '可以编写' : '未授权 · 需要管理员开启'}</span></div>
            </div>
          </Card>
          <Card title="资源访问令牌" className="min-w-0 flex-[1_1_360px]">
            <p className="text-[13px] text-ink-muted">同一账户的所有订阅共用一个令牌。公共规则可共享，节点和配置订阅仅限所属账户访问。</p>
            <ErrorAlert error={token.error} />
            <div className="flex flex-wrap gap-2">
              <CopyButton text={token.data ?? ''} disabled={!token.data}>复制令牌</CopyButton>
              <Button disabled={!token.data} onClick={() => void resetToken()}>重置令牌</Button>
            </div>
          </Card>
          <Card title="修改密码" className="min-w-0 flex-[1_1_360px]">
            <form onSubmit={submit} className="flex flex-col gap-3.5">
              <Field label="当前密码">{(id) => <Input placeholder="输入当前登录密码" id={id} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />}</Field>
              <Field label="新密码（至少 8 位）">{(id) => <Input placeholder="设置至少 8 位的新密码" id={id} type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />}</Field>
              <Field label="再次输入新密码" hint={confirm && confirm !== next ? '两次输入不一致' : undefined}>{(id) => <Input placeholder="再次输入新密码以确认" id={id} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />}</Field>
              <ErrorAlert error={change.error} />
              <div className="flex items-center justify-end gap-3">
                <Button type="submit" variant="primary" disabled={change.isPending || next !== confirm}>{change.isPending ? '更新中…' : '更新密码'}</Button>
              </div>
            </form>
          </Card>
        </div>
      </PageScroll>
    </>
  );
}
