import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { api, type User } from '../api.ts';
import { LogoMark } from '../components/LogoMark.tsx';
import { Button, ErrorBox, Field, Input } from '../components/ui.tsx';

export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const { user } = await api<{ user: User }>('POST', '/auth/login', { username, password });
      qc.setQueryData(['me'], user);
      navigate(from === '/login' ? '/' : from, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  // 设计稿「登录」：深色底，标志在上，白色卡片居中
  return (
    <div className="flex min-h-full flex-col items-center gap-6 bg-nav px-4 py-24">
      <div className="flex items-center gap-2.5">
        <LogoMark size={28} />
        <span className="font-mono text-xl font-semibold text-white">sub-forge</span>
      </div>
      <form onSubmit={submit} className="flex w-full max-w-[380px] flex-col gap-4 rounded-xl bg-panel p-6">
        <h1 className="m-0 text-lg font-semibold">登录</h1>
        <Field label="用户名">{(id) => <Input id={id} className="h-[42px] text-[14px]" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />}</Field>
        <Field label="密码">{(id) => <Input id={id} className="h-[42px] text-[14px]" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}</Field>
        <ErrorBox error={error} />
        <Button type="submit" variant="primary" className="h-11 text-[14px] font-semibold" disabled={busy}>{busy ? '登录中…' : '登录'}</Button>
        <span className="text-[12px] leading-relaxed text-muted">账户由管理员创建。忘记密码请联系管理员重置。</span>
      </form>
    </div>
  );
}
