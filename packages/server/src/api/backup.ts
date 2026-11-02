// 数据库备份配置、手动备份与恢复；仅管理员可用，响应不包含凭据。
import { Hono } from 'hono';
import { BackupError } from '../backup/errors.ts';
import type { BackupService } from '../backup/service.ts';
import { HttpError, jsonBody, requireAdmin, type ApiEnv } from './common.ts';

export function backupRoutes(backups: BackupService) {
  const app = new Hono<ApiEnv>();
  const guard = async <T>(work: () => T | Promise<T>): Promise<T> => {
    try { return await work(); }
    catch (error) { if (error instanceof BackupError) throw new HttpError(error.status, error.message); throw error; }
  };
  app.get('/system/backup', requireAdmin, c => c.json(backups.view()));
  app.put('/system/backup', requireAdmin, async c => { const body = await jsonBody(c); return c.json(await guard(() => backups.save(body))); });
  app.post('/system/backup/test', requireAdmin, async c => { const body = await jsonBody(c); return c.json(await guard(() => backups.test(body))); });
  app.get('/system/backup/files', requireAdmin, async c => c.json({ items: await guard(() => backups.files()) }));
  app.post('/system/backup/run', requireAdmin, async c => c.json(await guard(() => backups.run())));
  app.post('/system/backup/restore', requireAdmin, async c => {
    const body = await jsonBody<{ name?: unknown; passphrase?: unknown }>(c);
    if (typeof body.name !== 'string' || (body.passphrase !== undefined && typeof body.passphrase !== 'string')) throw new HttpError(400, '请选择要恢复的备份');
    await guard(() => backups.restore(body.name as string, body.passphrase as string | undefined));
    return c.json({ restarting: true }, 202);
  });
  return app;
}
