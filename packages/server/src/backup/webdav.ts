// 最小 WebDAV 客户端：只用备份所需的 PROPFIND / MKCOL / PUT / GET / DELETE。
// 地址由管理员配置，常见部署在内网 NAS，因此不套用订阅上游的内网地址限制。
// 重定向一律报错，避免 Basic 凭据或备份文件被转发到配置之外的地址。
import { BackupError } from './errors.ts';

export type WebDavConfig = { url: string; username: string; password: string };
export type WebDavFile = { name: string; size?: number; modifiedAt?: number };
export type FetchLike = typeof fetch;

const LIST_TIMEOUT_MS = 30_000;
const TRANSFER_TIMEOUT_MS = 10 * 60_000;

const tagValue = (xml: string, name: string) => new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>`, 'i').exec(xml)?.[1]?.trim();
const decodeEntities = (value: string) => value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (_, entity: string) => {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  if (named[entity.toLowerCase()]) return named[entity.toLowerCase()]!;
  return String.fromCodePoint(entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10));
});

/** 解析 PROPFIND 的 multistatus；命名空间前缀因服务端而异，只按本地名匹配。 */
export function parseMultistatus(xml: string): WebDavFile[] {
  const files: WebDavFile[] = [];
  for (const [, body] of xml.matchAll(/<(?:[\w.-]+:)?response(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?response>/gi)) {
    const href = tagValue(body!, 'href');
    if (!href || /<(?:[\w.-]+:)?collection\b/i.test(body!)) continue;
    const segment = decodeEntities(href).split('?')[0]!.split('/').filter(Boolean).pop();
    if (!segment) continue;
    let name: string;
    try { name = decodeURIComponent(segment); } catch { continue; }
    const size = Number(tagValue(body!, 'getcontentlength'));
    const modifiedAt = Date.parse(tagValue(body!, 'getlastmodified') ?? '');
    files.push({ name, ...(Number.isSafeInteger(size) && tagValue(body!, 'getcontentlength') ? { size } : {}), ...(Number.isNaN(modifiedAt) ? {} : { modifiedAt }) });
  }
  return files;
}

export function normalizeWebDavUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new BackupError(400, 'WebDAV 地址不是合法的 URL'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BackupError(400, 'WebDAV 地址只支持 http 或 https');
  if (url.username || url.password) throw new BackupError(400, 'WebDAV 账号和密码请填写在对应字段，不要写进地址');
  if (url.search || url.hash) throw new BackupError(400, 'WebDAV 地址不能包含查询参数');
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}

function statusMessage(action: string, status: number): string {
  if (status === 401) return `${action}失败：WebDAV 账号或密码不正确`;
  if (status === 403) return `${action}失败：WebDAV 账号没有权限`;
  if (status === 404) return `${action}失败：WebDAV 路径不存在`;
  if (status === 409) return `${action}失败：WebDAV 上级目录不存在，请先创建`;
  if (status === 507) return `${action}失败：WebDAV 存储空间不足`;
  if (status >= 300 && status < 400) return `${action}失败：WebDAV 返回重定向（${status}），请填写最终地址`;
  return `${action}失败：WebDAV 返回 ${status}`;
}

export class WebDavClient {
  private readonly base: string;
  constructor(private config: WebDavConfig, private fetchImpl: FetchLike = fetch) {
    this.base = normalizeWebDavUrl(config.url);
  }
  private async request(action: string, method: string, url: string, init: { headers?: Record<string, string>; body?: Uint8Array | string; timeout: number }): Promise<Response> {
    const auth = this.config.username ? { authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}` } : undefined;
    try {
      return await this.fetchImpl(url, { method, redirect: 'manual', signal: AbortSignal.timeout(init.timeout), headers: { ...auth, ...init.headers }, ...(init.body === undefined ? {} : { body: init.body }) });
    } catch (error) {
      const cause = error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : String(error);
      throw new BackupError(502, `${action}失败：无法连接 WebDAV（${cause}）`);
    }
  }
  private file(name: string): string { return this.base + encodeURIComponent(name); }
  async list(): Promise<WebDavFile[]> {
    const res = await this.request('读取备份列表', 'PROPFIND', this.base, { timeout: LIST_TIMEOUT_MS, headers: { depth: '1', 'content-type': 'application/xml; charset=utf-8' }, body: '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><resourcetype/><getcontentlength/><getlastmodified/></prop></propfind>' });
    if (res.status !== 207) { await res.body?.cancel(); throw new BackupError(502, statusMessage('读取备份列表', res.status)); }
    return parseMultistatus(await res.text());
  }
  /** 目录不存在时只创建最后一级；上级缺失由服务端返回 409 并提示。 */
  async ensureDirectory(): Promise<void> {
    const probe = await this.request('检查备份目录', 'PROPFIND', this.base, { timeout: LIST_TIMEOUT_MS, headers: { depth: '0' } });
    await probe.body?.cancel();
    if (probe.status === 207) return;
    if (probe.status !== 404) throw new BackupError(502, statusMessage('检查备份目录', probe.status));
    const made = await this.request('创建备份目录', 'MKCOL', this.base, { timeout: LIST_TIMEOUT_MS });
    await made.body?.cancel();
    if (!made.ok) throw new BackupError(502, statusMessage('创建备份目录', made.status));
  }
  async put(name: string, body: Uint8Array): Promise<void> {
    const res = await this.request('上传备份', 'PUT', this.file(name), { timeout: TRANSFER_TIMEOUT_MS, headers: { 'content-type': 'application/octet-stream' }, body });
    await res.body?.cancel();
    if (!res.ok) throw new BackupError(502, statusMessage('上传备份', res.status));
  }
  async get(name: string): Promise<Buffer> {
    const res = await this.request('下载备份', 'GET', this.file(name), { timeout: TRANSFER_TIMEOUT_MS });
    if (!res.ok) { await res.body?.cancel(); throw new BackupError(502, statusMessage('下载备份', res.status)); }
    return Buffer.from(await res.arrayBuffer());
  }
  async remove(name: string): Promise<void> {
    const res = await this.request('清理旧备份', 'DELETE', this.file(name), { timeout: LIST_TIMEOUT_MS });
    await res.body?.cancel();
    if (!res.ok && res.status !== 404) throw new BackupError(502, statusMessage('清理旧备份', res.status));
  }
}
