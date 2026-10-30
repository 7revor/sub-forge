// 客户端识别（CR-04）：URL 参数优先，其次 User-Agent；识别不了按 mihomo 处理并在访问日志里留下原始 UA。

import type { Client, Platform } from '@sub-forge/core';

export type DetectedClient = { client: Client; platform?: Platform; by: 'param' | 'ua' | 'default' };

const PLATFORMS: Platform[] = ['android', 'macos', 'windows', 'ios', 'linux'];

function platformFromUa(ua: string): Platform | undefined {
  // Clash Verge / FlClash 的 UA 自带 Platform/<平台>
  const explicit = /Platform\/(\w+)/i.exec(ua)?.[1]?.toLowerCase();
  const hit = PLATFORMS.find((p) => p === explicit);
  if (hit) return hit;
  if (/android|ClashMetaForAndroid/i.test(ua)) return 'android';
  if (/iPhone|iPad|\biOS\b/i.test(ua)) return 'ios';
  if (/Macintosh|macOS|Mac OS|\bMac\b|darwin/i.test(ua)) return 'macos';
  if (/Windows|win32|win64/i.test(ua)) return 'windows';
  if (/Linux/i.test(ua)) return 'linux';
  return undefined;
}

export class InvalidClientTarget extends Error {}

export function detectClient(ua: string, query: { target?: string | undefined; platform?: string | undefined }): DetectedClient {
  const qp = query.platform?.toLowerCase();
  if (qp !== undefined && !PLATFORMS.some(p => p === qp)) throw new InvalidClientTarget('不支持的平台：' + qp);
  const paramPlatform = PLATFORMS.find((p) => p === qp);
  const t = query.target?.toLowerCase();
  if (t === 'loon' || t === 'stash' || t === 'surge' || t === 'mihomo' || t === 'clash' || t === 'clash.meta') {
    const client: Client = t === 'loon' || t === 'surge' || t === 'stash' ? t : 'mihomo';
    const platform = paramPlatform ?? platformFromUa(ua);
    return platform ? { client, platform, by: 'param' } : { client, by: 'param' };
  }
  if (t !== undefined) throw new InvalidClientTarget('不支持的目标客户端：' + t);
  if (/loon/i.test(ua)) return { client: 'loon', platform: paramPlatform ?? platformFromUa(ua) ?? 'ios', by: 'ua' };
  if (/stash/i.test(ua)) return { client: 'stash', platform: paramPlatform ?? platformFromUa(ua) ?? 'ios', by: 'ua' };
  if (/surge/i.test(ua)) {
    const platform = paramPlatform ?? (/iOS|iPhone|iPad/i.test(ua) ? 'ios' : 'macos');
    return { client: 'surge', platform, by: 'ua' };
  }
  const platform = paramPlatform ?? platformFromUa(ua);
  const known = /mihomo|clash[.-]?meta|clash-verge|FlClash|ClashMetaForAndroid|clash/i.test(ua);
  const by = known ? 'ua' : 'default';
  return platform ? { client: 'mihomo', platform, by } : { client: 'mihomo', by };
}
