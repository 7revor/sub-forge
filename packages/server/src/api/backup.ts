// 数据库备份文件的下载与上传恢复；仅管理员可用。
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { BackupError } from '../backup/errors.ts';
import type { BackupService } from '../backup/service.ts';
import { HttpError, requireAdmin, type ApiEnv } from './common.ts';

const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

export function backupRoutes(backups: BackupService) {
  const app = new Hono<ApiEnv>();
  const guard = async <T>(work: () => T | Promise<T>): Promise<T> => {
    try { return await work(); }
    catch (error) { if (error instanceof BackupError) throw new HttpError(error.status, error.message); throw error; }
  };
  app.get('/system/backup/download', requireAdmin, async c => {
    const { name, body } = await guard(() => backups.create());
    return c.body(new Uint8Array(body), 200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${name}"`, 'content-length': String(body.length) });
  });
  app.post('/system/backup/restore', requireAdmin, bodyLimit({ maxSize: MAX_UPLOAD_BYTES, onError: c => c.json({ error: '备份文件超过 512 MB' }, 413) }), async c => {
    const body = Buffer.from(await c.req.arrayBuffer());
    if (!body.length) throw new HttpError(400, '请选择要恢复的备份文件');
    await guard(() => backups.restore(body));
    return c.json({ restarting: true }, 202);
  });
  return app;
}
