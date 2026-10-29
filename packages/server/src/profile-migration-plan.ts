// 在一致性副本上执行迁移预检，源数据库只读，不输出节点凭据或订阅令牌。
import Database from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Cipher } from './crypto.ts';
import { Store } from './store.ts';

export async function profileMigrationPlan(path: string, cipher: Cipher) {
  const source = new Database(path, { readonly: true, fileMustExist: true });
  let folder: string | undefined;
  let copy: Store | undefined;
  try {
    folder = await mkdtemp(join(tmpdir(), 'sf-migration-plan-'));
    const target = join(folder, 'check.sqlite');
    await source.backup(target);
    copy = new Store(target, { cipher });
    return { sourceVersion: source.pragma('user_version', { simple: true }), targetVersion: copy.db.pragma('user_version', { simple: true }),
      profiles: copy.list('profile').map(p => ({ id: p.id, name: p.name, mode: p.routing?.mode, reason: p.migration?.reason ?? '已使用新分流模式', issues: p.migration?.issues ?? [] })),
    };
  } finally {
    copy?.close(); source.close();
    if (folder) await rm(folder, { recursive: true });
  }
}
