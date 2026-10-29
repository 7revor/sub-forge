import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../api.ts';
import { Button, Card, ErrorBox, Field, Input, PageHeader } from '../components/ui.tsx';
import { useMe } from '../hooks.ts';

export function Account() {
  const me = useMe().data;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const change = useMutation({ mutationFn: () => api('POST', '/me/password', { current, next }) });

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
      <div className="flex flex-wrap items-start gap-5">
        <Card title="当前用户" className="min-w-0 flex-[1_1_360px]">
          <div className="flex flex-col">
            <div className={kv}><span className="text-muted">用户名</span><span>{me?.username}</span></div>
            <div className={kv}><span className="text-muted">角色</span><span>{me?.role === 'admin' ? '管理员' : '普通用户'}</span></div>
            <div className={kv}><span className="text-muted">脚本处理器</span><span>{scripts ? '可以编写' : '未授权 · 需要管理员开启'}</span></div>
          </div>
        </Card>
        <Card title="修改密码" className="min-w-0 flex-[1_1_360px]">
          <form onSubmit={submit} className="flex flex-col gap-3.5">
            <Field label="当前密码">{(id) => <Input id={id} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />}</Field>
            <Field label="新密码（至少 8 位）">{(id) => <Input id={id} type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />}</Field>
            <Field label="再次输入新密码" hint={confirm && confirm !== next ? '两次输入不一致' : undefined}>{(id) => <Input id={id} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />}</Field>
            <ErrorBox error={change.error} />
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12.5px] text-ok">{change.isSuccess ? '密码已更新，其他设备需要重新登录' : ''}</span>
              <Button type="submit" variant="primary" disabled={change.isPending || next !== confirm}>{change.isPending ? '更新中…' : '更新密码'}</Button>
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}
