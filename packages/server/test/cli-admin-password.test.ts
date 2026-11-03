import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { Cipher, hashPassword, verifyPassword } from '../src/crypto.ts';
import { Store } from '../src/store.ts';

const run = promisify(execFile);
const secret = Buffer.from('11'.repeat(32), 'hex');

it('reset-admin-password 只重置管理员密码，已有登录失效，令牌和其他用户不变', { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'sf-reset-admin-'));
  const db = join(root, 'test.db');
  const open = () => new Store(db, { cipher: new Cipher(secret) });
  const cli = (args: string[], password?: string) => run(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
    env: { ...process.env, SUBFORGE_DB: db, SUBFORGE_SECRET: secret.toString('base64'), SUBFORGE_ADMIN_PASSWORD: password ?? '' },
  });
  try {
    const empty = open(); empty.close();
    await expect(cli(['reset-admin-password'], 'new-password-1')).rejects.toThrow('还没有管理员');

    const before = open();
    const oldHash = await hashPassword('old-password-1');
    const admin = before.createUser({ username: 'root', passwordHash: oldHash, role: 'admin' });
    const bob = before.createUser({ username: 'bob', passwordHash: oldHash, role: 'user' });
    const adminSession = before.createSession(admin.id, 60_000);
    const bobSession = before.createSession(bob.id, 60_000);
    const token = before.createToken(admin.id).token;
    before.close();

    await expect(cli(['reset-admin-password'], 'short')).rejects.toThrow('至少 8 位');
    await expect(cli(['create-admin', 'another'], 'new-password-1')).rejects.toThrow('管理员已存在');
    const { stdout } = await cli(['reset-admin-password'], 'new-password-1');
    expect(stdout).toContain('root');
    expect(stdout).not.toContain('new-password-1');

    const after = open();
    expect(await verifyPassword('new-password-1', after.getUserAuth('root')!.passwordHash)).toBe(true);
    expect(await verifyPassword('old-password-1', after.getUserAuth('root')!.passwordHash)).toBe(false);
    expect(after.getUserAuth('bob')!.passwordHash).toBe(oldHash);
    expect(after.getSessionUser(adminSession)).toBeUndefined();
    expect(after.getSessionUser(bobSession)?.id).toBe(bob.id);
    expect(after.getActiveToken(token)?.userId).toBe(admin.id);
    after.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});
