import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.ts';
import { createModal, useModalDraft, ModalContent, ModalDescription, ModalFooter, ModalHeader, ModalTitle } from '../modals/index.tsx';
import { Pagination } from './Pagination.tsx';
import { Badge, Button, ErrorAlert, Field, Input, Switch, formatBytes, formatTime } from './ui.tsx';

export type BackupView = {
  enabled: boolean; url: string; username: string; hasPassword: boolean; hasPassphrase: boolean; intervalHours: number; retain: number; running: boolean; nextRunAt?: number;
  state: { lastAttemptAt?: number; lastSuccessAt?: number; lastFile?: string; lastSize?: number; lastError?: string; lastWarning?: string; lastRestoreAt?: number; lastRestoreFile?: string };
};
type BackupFile = { name: string; size?: number; modifiedAt?: number };

const validInteger = (value: string, max: number) => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= max;

export const BackupSettingsModal = createModal<{ backup: BackupView }, BackupView>(function BackupSettings({ data: { backup }, modal }) {
  const [form, setForm] = useModalDraft({ enabled: backup.enabled, url: backup.url, username: backup.username, password: '', passphrase: '', intervalHours: String(backup.intervalHours), retain: String(backup.retain) });
  const [probe, setProbe] = useModalDraft<{ pending?: boolean; message?: string; error?: string }>({});
  const patch = (next: Partial<typeof form>) => { setForm({ ...form, ...next }); setProbe({}); };
  const test = async () => {
    setProbe({ pending: true });
    try {
      const result = await api<{ count: number }>('POST', '/system/backup/test', { url: form.url, username: form.username, ...(form.password ? { password: form.password } : {}) });
      setProbe({ message: `连接成功，目录中有 ${result.count} 份备份` });
    } catch (error) {
      setProbe({ error: error instanceof Error ? error.message : String(error) });
    }
  };
  const intervalValid = validInteger(form.intervalHours, 8760), retainValid = validInteger(form.retain, 365);
  const passphraseValid = !form.passphrase || form.passphrase.length >= 8;
  const ready = intervalValid && retainValid && passphraseValid && (!form.enabled || (!!form.url.trim() && (backup.hasPassphrase || !!form.passphrase)));
  return <ModalContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[480px]">
    <ModalHeader className="px-6 pt-5 pb-4"><ModalTitle>配置 WebDAV 备份</ModalTitle><ModalDescription>备份文件含数据库和主密钥，上传前用备份口令加密。</ModalDescription></ModalHeader>
    <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 pb-5">
      <Field label="WebDAV 地址">{id => <Input id={id} autoFocus placeholder="填写备份目录地址，如 https://dav.example.com/sub-forge/" value={form.url} onChange={event => patch({ url: event.target.value })} />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="账号">{id => <Input id={id} autoComplete="off" placeholder="无需认证时留空" value={form.username} onChange={event => patch({ username: event.target.value })} />}</Field>
        <Field label="密码">{id => <Input id={id} type="password" autoComplete="new-password" placeholder={backup.hasPassword ? '已设置，留空保持不变' : '密码或应用专用密码'} value={form.password} onChange={event => patch({ password: event.target.value })} />}</Field>
      </div>
      <div className="flex flex-wrap items-center gap-3"><Button size="sm" disabled={!form.url.trim() || probe.pending} onClick={() => void test()}>{probe.pending ? '测试中…' : '测试连接'}</Button>
        {probe.message && <span role="status" className="text-sm text-muted-foreground">{probe.message}</span>}{probe.error && <span role="alert" className="text-sm text-destructive">{probe.error}</span>}</div>
      <Field label="备份口令" hint="用于加密备份文件。换机恢复时需要输入，丢失后备份无法解密。">{id => <Input id={id} type="password" autoComplete="new-password" placeholder={backup.hasPassphrase ? '已设置，留空保持不变' : '设置至少 8 位的备份口令'} value={form.passphrase} onChange={event => patch({ passphrase: event.target.value })} />}</Field>
      {!passphraseValid && <span className="text-sm text-destructive">备份口令至少 8 位。</span>}
      <div className="flex items-center justify-between gap-4 text-sm"><span>启用定时备份</span><Switch label="启用定时备份" checked={form.enabled} onChange={enabled => patch({ enabled })} /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="备份间隔（小时）">{id => <Input id={id} type="number" min={1} max={8760} step={1} placeholder="每隔多少小时备份，1 至 8760" value={form.intervalHours} onChange={event => patch({ intervalHours: event.target.value })} />}</Field>
        <Field label="保留份数">{id => <Input id={id} type="number" min={1} max={365} step={1} placeholder="WebDAV 上保留的份数，1 至 365" value={form.retain} onChange={event => patch({ retain: event.target.value })} />}</Field>
      </div>
      {(!intervalValid || !retainValid) && <span className="text-sm text-destructive">备份间隔须为 1 至 8760 的整数，保留份数须为 1 至 365 的整数。</span>}
    </div>
    <ModalFooter className="border-t border-border px-6 py-3"><Button onClick={modal.cancel}>取消</Button><Button variant="primary" disabled={!ready || modal.pending} onClick={() => void modal.submit(() => api<BackupView>('PUT', '/system/backup', {
      enabled: form.enabled, url: form.url, username: form.username, intervalHours: Number(form.intervalHours), retain: Number(form.retain), ...(form.password ? { password: form.password } : {}), ...(form.passphrase ? { passphrase: form.passphrase } : {}),
    }))}>{modal.pending ? '保存中…' : '保存'}</Button></ModalFooter>
  </ModalContent>;
});

const bootId = () => fetch('/healthz', { cache: 'no-store' }).then(response => response.ok ? response.headers.get('x-boot-id') : null, () => null);

/** 服务在 202 之后关闭并进程内重启；启动 ID 变化才算恢复完成。 */
async function waitForRestart(before: string | null, signal: AbortSignal) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (signal.aborted) return;
    const current = await bootId();
    if (current && current !== before) return;
  }
  throw new Error('等待服务重启超时，请检查服务日志');
}

export const RestoreBackupModal = createModal<{ file: BackupFile; hasPassphrase: boolean }, { restored: true }>(function RestoreBackup({ data: { file, hasPassphrase }, modal }) {
  const [passphrase, setPassphrase] = useModalDraft('');
  return <ModalContent className="sm:max-w-[440px]">
    <ModalHeader><ModalTitle>恢复备份「{file.name}」？</ModalTitle><ModalDescription>所有用户、配置和访问日志都会替换为备份时的内容，服务随后自动重启，可能需要重新登录。当前 WebDAV 配置会保留，原数据库保存为 .before-restore 文件。</ModalDescription></ModalHeader>
    <Field label="备份口令" hint={hasPassphrase ? '与当前口令相同时可以留空。' : undefined}>{id => <Input id={id} type="password" autoComplete="off" autoFocus placeholder={hasPassphrase ? '备份时的口令，与当前相同可留空' : '输入创建该备份时使用的口令'} value={passphrase} onChange={event => setPassphrase(event.target.value)} />}</Field>
    <ModalFooter><Button onClick={modal.cancel}>取消</Button><Button variant="danger" disabled={modal.pending || (!hasPassphrase && !passphrase)} onClick={() => void modal.submit(async () => {
      const before = await bootId();
      await api('POST', '/system/backup/restore', { name: file.name, ...(passphrase ? { passphrase } : {}) });
      await waitForRestart(before, modal.signal);
      return { restored: true as const };
    })}>{modal.pending ? '恢复中…' : '恢复并重启'}</Button></ModalFooter>
  </ModalContent>;
});

export function BackupSettings() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const backup = useQuery({ queryKey: ['system-backup'], queryFn: () => api<BackupView>('GET', '/system/backup') });
  const data = backup.data;
  const files = useQuery({ queryKey: ['system-backup-files', data?.url], enabled: !!data?.url, queryFn: () => api<{ items: BackupFile[] }>('GET', '/system/backup/files') });
  const run = useMutation({ meta: { successMessage: '备份已上传' }, mutationFn: () => api('POST', '/system/backup/run'), onSettled: () => { void qc.invalidateQueries({ queryKey: ['system-backup'] }); void qc.invalidateQueries({ queryKey: ['system-backup-files'] }); } });
  const configure = async () => {
    if (!data) return;
    const result = await BackupSettingsModal.show({ backup: data });
    if (result.status === 'confirmed') { qc.setQueryData(['system-backup'], result.data); void qc.invalidateQueries({ queryKey: ['system-backup-files'] }); }
  };
  const restore = async (file: BackupFile) => {
    if (!data) return;
    const result = await RestoreBackupModal.show({ file, hasPassphrase: data.hasPassphrase });
    if (result.status === 'confirmed') window.location.assign('/');
  };
  const items = files.data?.items ?? [];
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, totalPages);
  const state = data?.state;
  return <div className="settings-row"><div><h2 className="flex items-center gap-1.5">数据库备份 {data && <Badge tone={data.enabled ? 'ok' : undefined} className="h-5">{data.enabled ? '定时开启' : '定时关闭'}</Badge>}</h2><p>加密后上传到 WebDAV，可从备份恢复</p></div><div className="flex min-w-0 flex-col gap-3">
    <ErrorAlert error={backup.error ?? run.error} />
    {!data ? <p className="text-muted-foreground">正在读取备份设置…</p> : <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 text-sm"><div className="break-all font-medium">{data.url || '尚未配置 WebDAV'}</div>
          {data.url && <p>{data.enabled ? `每 ${data.intervalHours} 小时备份 · 保留 ${data.retain} 份${data.nextRunAt ? ` · 下次 ${formatTime(data.nextRunAt)}` : ''}` : `未启用定时备份 · 保留 ${data.retain} 份`}</p>}
          <p>{state?.lastSuccessAt ? `最近成功：${formatTime(state.lastSuccessAt)}${state.lastSize ? ` · ${formatBytes(state.lastSize)}` : ''}` : '尚未成功备份'}{state?.lastRestoreAt ? ` · 最近恢复：${formatTime(state.lastRestoreAt)}` : ''}</p>
          {state?.lastError && <p className="!text-red-600">最近一次失败：{state.lastError}</p>}
          {state?.lastWarning && <p className="!text-amber-600">{state.lastWarning}</p>}
        </div>
        <div className="flex shrink-0 gap-2"><Button size="sm" onClick={() => void configure()}>配置</Button><Button size="sm" variant="primary" disabled={!data.url || !data.hasPassphrase || data.running || run.isPending} onClick={() => run.mutate()}>{data.running || run.isPending ? '备份中…' : '立即备份'}</Button></div>
      </div>
      {data.url && <div className="min-w-0"><ErrorAlert error={files.error} />
        {files.isPending ? <p className="text-muted-foreground">正在读取备份文件…</p> : !items.length ? !files.error && <p className="text-muted-foreground">该目录还没有备份文件。</p> : <>
          <ul className="flex list-none flex-col p-0">{items.slice((current - 1) * pageSize, current * pageSize).map(file => <li key={file.name} className="flex items-center justify-between gap-4 border-b border-border py-2.5 last:border-0 text-sm">
            <div className="min-w-0"><div className="break-all font-medium">{file.name}</div><p>{[file.modifiedAt ? formatTime(file.modifiedAt) : '', file.size === undefined ? '' : formatBytes(file.size)].filter(Boolean).join(' · ')}</p></div>
            <Button size="sm" variant="danger" disabled={data.running} onClick={() => void restore(file)}>恢复</Button>
          </li>)}</ul>
          <Pagination className="!px-0 !pb-0" page={current} pageSize={pageSize} total={items.length} totalPages={totalPages} onPage={setPage} onPageSize={value => { setPageSize(value); setPage(1); }} />
        </>}
      </div>}
    </>}
  </div></div>;
}
