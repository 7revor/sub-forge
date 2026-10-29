import { notifySuccess } from '../feedback.ts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.ts';
import { Badge, Button, ErrorAlert, Field, Input } from './ui.tsx';

type TokenStatus = { configured: boolean };

export function GithubTokenSettings() {
  const qc = useQueryClient();
  const [token, setToken] = useState('');
  const status = useQuery({ queryKey: ['github-index-token'], queryFn: () => api<TokenStatus>('GET', '/rule-repos/github-token') });
  const save = useMutation({
    mutationFn: (value: string | undefined) => value === undefined
      ? api<TokenStatus>('DELETE', '/rule-repos/github-token')
      : api<TokenStatus>('PUT', '/rule-repos/github-token', { token: value }),
    onSuccess: data => { qc.setQueryData(['github-index-token'], data); setToken(''); notifySuccess(data.configured ? '已保存，后续仓库信息查询立即生效。' : '已清除，后续 API 查询使用匿名请求。'); },
  });
  return (
    <form className="flex flex-col gap-2 border-b border-line-2 pb-4" onSubmit={e => { e.preventDefault(); if (token.trim()) save.mutate(token.trim()); }}>
      <div className="flex items-center gap-2"><span className="text-[13.5px] font-medium">GitHub Token</span><Badge>{status.isPending ? '读取中…' : status.data ? (status.data.configured ? '已配置' : '未配置') : '状态读取失败'}</Badge></div>
      <Field label={status.data?.configured ? '替换 Token' : '配置 Token'} hint="用于添加或修改仓库时读取 GitHub 信息，加密保存且不回显。Git 缓存同步无需 Token。">
        {id => <Input id={id} type="password" autoComplete="new-password" spellCheck={false} value={token} disabled={save.isPending} placeholder={status.data?.configured ? '输入新 Token 以替换' : '输入 GitHub personal access token'} onChange={e => setToken(e.target.value)} />}
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={!status.data || !token.trim() || save.isPending}>{save.isPending ? '处理中…' : '保存 Token'}</Button>
        {status.data?.configured && <Button type="button" disabled={save.isPending} onClick={() => save.mutate(undefined)}>清除 Token</Button>}
        <a className="text-[12px] text-accent" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">创建 GitHub Token</a>
      </div>
      <ErrorAlert error={save.error ?? status.error} />
    </form>
  );
}
