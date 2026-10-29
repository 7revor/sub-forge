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

  return (
    <div className="flex min-h-full items-center justify-center bg-ground p-4">
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-line bg-panel p-6">
        <div className="flex items-center gap-3">
          <LogoMark size={40} />
          <div className="flex flex-col gap-0.5">
            <h1 className="m-0 font-mono text-xl font-semibold">sub-forge</h1>
            <p className="m-0 text-[13px] text-muted">登录以管理订阅</p>
          </div>
        </div>
        <Field label="用户名">{(id) => <Input id={id} autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />}</Field>
        <Field label="密码">{(id) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}</Field>
        <ErrorBox error={error} />
        <Button type="submit" variant="primary" disabled={busy}>{busy ? '登录中…' : '登录'}</Button>
      </form>
    </div>
  );
}
