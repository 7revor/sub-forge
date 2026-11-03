// 备份文件格式：`SFBAK2\n` + 头部 JSON + `\n` + gzip(32 字节主密钥 + SQLite 文件)。
// 主密钥随备份走，否则换机恢复后无法匹配 HMAC 索引。
// 文件不加密（2026-11-03）：含主密钥、令牌和节点凭据，由管理员自行保管下载的文件。
import { promisify } from 'node:util';
import { gunzip as gunzipCb, gzip as gzipCb } from 'node:zlib';
import { BackupError } from './errors.ts';

const MAGIC = 'SFBAK2\n';
const ENCRYPTED_MAGIC = 'SFBAK1\n';
const KEY_LENGTH = 32;
/** 文件来自上传，限制解压后大小，避免被构造的压缩包耗尽内存。 */
const MAX_PLAIN_BYTES = 2 * 1024 ** 3;
const gzip = promisify(gzipCb);
const gunzip = promisify(gunzipCb);

type Header = { v: 2; createdAt: number; schemaVersion: number };
export type BackupContents = { db: Buffer; masterKey: Buffer; createdAt: number; schemaVersion: number };

export async function encodeBackup(contents: BackupContents): Promise<Buffer> {
  if (contents.masterKey.length !== KEY_LENGTH) throw new Error('主密钥必须是 32 字节');
  const header: Header = { v: 2, createdAt: contents.createdAt, schemaVersion: contents.schemaVersion };
  return Buffer.concat([Buffer.from(`${MAGIC}${JSON.stringify(header)}\n`, 'utf8'), await gzip(Buffer.concat([contents.masterKey, contents.db]))]);
}

export async function decodeBackup(file: Buffer): Promise<BackupContents> {
  const invalid = () => new BackupError(400, '不是有效的 Sub Forge 备份文件');
  const magic = file.subarray(0, MAGIC.length).toString('utf8');
  if (magic === ENCRYPTED_MAGIC) throw new BackupError(400, '这是旧版加密备份，当前版本已不支持恢复');
  if (magic !== MAGIC) throw invalid();
  const headEnd = file.indexOf(0x0a, MAGIC.length);
  if (headEnd < 0) throw invalid();
  let header: Header;
  try { header = JSON.parse(file.subarray(MAGIC.length, headEnd).toString('utf8')) as Header; } catch { throw invalid(); }
  if (header?.v !== 2 || !Number.isSafeInteger(header.schemaVersion) || !Number.isSafeInteger(header.createdAt)) throw invalid();
  let plain: Buffer;
  try {
    plain = await gunzip(file.subarray(headEnd + 1), { maxOutputLength: MAX_PLAIN_BYTES });
  } catch {
    throw new BackupError(400, '备份文件已损坏，或解压后超过 2 GB');
  }
  if (plain.length <= KEY_LENGTH) throw invalid();
  return { masterKey: plain.subarray(0, KEY_LENGTH), db: plain.subarray(KEY_LENGTH), createdAt: header.createdAt, schemaVersion: header.schemaVersion };
}
