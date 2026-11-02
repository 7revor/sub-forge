// 备份文件格式：`SFBAK1\n` + 头部 JSON + `\n` + AES-256-GCM 密文 + 16 字节认证标签。
// 明文是 gzip(32 字节主密钥 + SQLite 文件)，头部作为附加认证数据。
// 主密钥随备份走，否则换机恢复后无法解密文档，也无法匹配 HMAC 索引；因此整包必须用独立口令加密。
import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb } from 'node:crypto';
import { promisify } from 'node:util';
import { gunzip as gunzipCb, gzip as gzipCb } from 'node:zlib';
import { BackupError } from './errors.ts';

const MAGIC = 'SFBAK1\n';
const KDF = { N: 2 ** 15, r: 8, p: 1 };
const KEY_LENGTH = 32;
const TAG_LENGTH = 16;
const gzip = promisify(gzipCb);
const gunzip = promisify(gunzipCb);

type Header = { v: 1; createdAt: number; schemaVersion: number; salt: string; iv: string; kdf: typeof KDF };
export type BackupContents = { db: Buffer; masterKey: Buffer; createdAt: number; schemaVersion: number };

function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCb(passphrase.normalize('NFKC'), salt, KEY_LENGTH, { ...KDF, maxmem: 128 * KDF.N * KDF.r * 2 }, (error, key) => error ? reject(error) : resolve(key)));
}

export async function encodeBackup(contents: BackupContents, passphrase: string): Promise<Buffer> {
  if (contents.masterKey.length !== KEY_LENGTH) throw new Error('主密钥必须是 32 字节');
  const salt = randomBytes(16), iv = randomBytes(12);
  const header: Header = { v: 1, createdAt: contents.createdAt, schemaVersion: contents.schemaVersion, salt: salt.toString('base64'), iv: iv.toString('base64'), kdf: KDF };
  const head = Buffer.from(`${MAGIC}${JSON.stringify(header)}\n`, 'utf8');
  const cipher = createCipheriv('aes-256-gcm', await deriveKey(passphrase, salt), iv);
  cipher.setAAD(head);
  const body = Buffer.concat([cipher.update(await gzip(Buffer.concat([contents.masterKey, contents.db]))), cipher.final()]);
  return Buffer.concat([head, body, cipher.getAuthTag()]);
}

export async function decodeBackup(file: Buffer, passphrase: string): Promise<BackupContents> {
  const invalid = () => new BackupError(400, '不是有效的 Sub Forge 备份文件');
  if (file.subarray(0, MAGIC.length).toString('utf8') !== MAGIC) throw invalid();
  const headEnd = file.indexOf(0x0a, MAGIC.length);
  if (headEnd < 0) throw invalid();
  let header: Header;
  try { header = JSON.parse(file.subarray(MAGIC.length, headEnd).toString('utf8')) as Header; } catch { throw invalid(); }
  // 参数来自外部文件，只接受当前版本写入的 KDF 成本，避免被构造成耗尽内存。
  if (header.v !== 1 || header.kdf?.N !== KDF.N || header.kdf.r !== KDF.r || header.kdf.p !== KDF.p || file.length < headEnd + 1 + TAG_LENGTH) throw invalid();
  const decipher = createDecipheriv('aes-256-gcm', await deriveKey(passphrase, Buffer.from(header.salt, 'base64')), Buffer.from(header.iv, 'base64'));
  decipher.setAAD(file.subarray(0, headEnd + 1));
  decipher.setAuthTag(file.subarray(file.length - TAG_LENGTH));
  let compressed: Buffer;
  try {
    compressed = Buffer.concat([decipher.update(file.subarray(headEnd + 1, file.length - TAG_LENGTH)), decipher.final()]);
  } catch {
    throw new BackupError(400, '备份口令不正确，或备份文件已损坏');
  }
  const plain = await gunzip(compressed);
  return { masterKey: plain.subarray(0, KEY_LENGTH), db: plain.subarray(KEY_LENGTH), createdAt: header.createdAt, schemaVersion: header.schemaVersion };
}
