// 主密钥只用于两件事：系统设置中备份凭据（WebDAV 密码、备份口令）的 AES-256-GCM 加密，以及令牌、URL 查找索引的 HMAC。
// 文档、快照和令牌原文自 v35 起明文存储，decrypt 只再用于读取备份设置和升级旧数据。
// 密钥来自环境变量 SUBFORGE_SECRET，未设置时在数据库旁生成 secret.key（权限 0600）。

import { createCipheriv, createDecipheriv, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const PREFIX = 'enc:v1:';
const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export class Cipher {
  private readonly encKey: Buffer;
  private readonly macKey: Buffer;

  constructor(master: Buffer) {
    if (master.length !== 32) throw new Error('主密钥必须是 32 字节');
    // 加密与 HMAC 用不同的派生密钥
    this.encKey = createHmac('sha256', master).update('sub-forge:enc').digest();
    this.macKey = createHmac('sha256', master).update('sub-forge:mac').digest();
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.encKey, iv);
    const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
  }

  /** 没有加密前缀的旧数据原样返回（兼容加密前写入的开发数据库） */
  decrypt(value: string): string {
    if (!value.startsWith(PREFIX)) return value;
    const buf = Buffer.from(value.slice(PREFIX.length), 'base64');
    const d = createDecipheriv('aes-256-gcm', this.encKey, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
  }

  hmac(value: string): string {
    return createHmac('sha256', this.macKey).update(value).digest('base64url');
  }
}

/** 读取或生成主密钥：环境变量优先；否则使用数据库目录下的 secret.key */
export function loadMasterKey(dbPath: string, envValue: string | undefined): Buffer {
  if (envValue) {
    const k = Buffer.from(envValue, 'base64');
    if (k.length !== 32) throw new Error('SUBFORGE_SECRET 必须是 32 字节的 Base64');
    return k;
  }
  if (dbPath === ':memory:') return randomBytes(32);
  const file = join(dirname(dbPath), 'secret.key');
  if (existsSync(file)) return Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
  const k = randomBytes(32);
  writeFileSync(file, k.toString('base64') + '\n', { mode: 0o600, flag: 'wx' });
  return k;
}

// ---------- 密码 ----------

const SCRYPT_LEN = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT_LEN);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, salt, key] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}

/** URL 安全的随机串：订阅 token、会话 ID、文档 ID */
export function randomId(bytes = 18): string {
  return randomBytes(bytes).toString('base64url');
}
