import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../api.ts';
import { Badge, Button, Card, ErrorBox, Field, Input, PageHeader } from '../components/ui.tsx';
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

  return (
    <>
      <PageHeader title="账户" />
      <Card title="当前用户">
        <div className="flex flex-wrap items-center gap-2 text-[13.5px]">
          <span className="font-medium">{me?.username}</span>
          <Badge tone="accent">{me?.role === 'admin' ? '管理员' : '用户'}</Badge>
          <Badge tone={me?.scriptAllowed || me?.role === 'admin' ? 'ok' : 'neutral'}>{me?.scriptAllowed || me?.role === 'admin' ? '可编写脚本处理器' : '不可编写脚本处理器'}</Badge>
        </div>
      </Card>
      <Card title="修改密码">
        <form onSubmit={submit} className="flex max-w-md flex-col gap-3.5">
          <Field label="当前密码">{(id) => <Input id={id} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />}</Field>
          <Field label="新密码" hint="至少 8 位">{(id) => <Input id={id} type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />}</Field>
          <Field label="确认新密码" hint={confirm && confirm !== next ? '两次输入不一致' : undefined}>{(id) => <Input id={id} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />}</Field>
          <ErrorBox error={change.error} />
          {change.isSuccess && <div className="text-[13px] text-ok">密码已修改，其他设备需要重新登录。</div>}
          <div><Button type="submit" variant="primary" disabled={change.isPending || next !== confirm}>保存</Button></div>
        </form>
      </Card>
    </>
  );
}
