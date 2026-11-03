import { useMutation } from '@tanstack/react-query';
import { uploadFile, downloadFile } from '../api.ts';
import { createModal, useModalDraft, ModalContent, ModalDescription, ModalFooter, ModalHeader, ModalTitle } from '../modals/index.tsx';
import { Button, ErrorAlert, Field, Input, formatBytes } from './ui.tsx';

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

export const RestoreBackupModal = createModal<void, { restored: true }>(function RestoreBackup({ modal }) {
  const [file, setFile] = useModalDraft<File | null>(null);
  return <ModalContent className="sm:max-w-[440px]">
    <ModalHeader><ModalTitle>上传备份并恢复</ModalTitle><ModalDescription>所有用户、配置和访问日志都会替换为备份时的内容，服务随后自动重启，可能需要重新登录。原数据库保存为 .before-restore 文件。</ModalDescription></ModalHeader>
    <Field label="备份文件" hint={file ? `${file.name} · ${formatBytes(file.size)}` : '选择之前下载的 .sfbak 文件，最大 512 MB。'}>{id => <Input id={id} type="file" accept=".sfbak" autoFocus placeholder="选择之前下载的 .sfbak 备份文件" onChange={event => setFile(event.target.files?.[0] ?? null)} />}</Field>
    <ModalFooter><Button onClick={modal.cancel}>取消</Button><Button variant="danger" disabled={modal.pending || !file} onClick={() => void modal.submit(async () => {
      const before = await bootId();
      await uploadFile('/system/backup/restore', file!);
      await waitForRestart(before, modal.signal);
      return { restored: true as const };
    })}>{modal.pending ? '恢复中…' : '恢复并重启'}</Button></ModalFooter>
  </ModalContent>;
});

export function BackupSettings() {
  const download = useMutation({ meta: { successMessage: '备份文件已下载' }, mutationFn: () => downloadFile('/system/backup/download') });
  const restore = async () => {
    const result = await RestoreBackupModal.show();
    if (result.status === 'confirmed') window.location.assign('/');
  };
  return <div className="settings-row"><div><h2>数据库备份</h2><p>下载备份文件自行保存，需要时上传恢复</p></div><div className="flex min-w-0 flex-col gap-3">
    <ErrorAlert error={download.error} />
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="min-w-0 text-sm">备份文件未加密，含主密钥、订阅令牌和节点凭据，请妥善保管。</p>
      <div className="flex shrink-0 gap-2"><Button size="sm" onClick={() => void restore()}>上传恢复</Button><Button size="sm" variant="primary" disabled={download.isPending} onClick={() => download.mutate()}>{download.isPending ? '生成中…' : '下载备份'}</Button></div>
    </div>
  </div></div>;
}
