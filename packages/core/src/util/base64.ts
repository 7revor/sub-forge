// 不依赖 Node Buffer，浏览器同样可用。

/** 解码标准或 URL-safe Base64（容忍缺失的 padding 与换行），按 UTF-8 解为字符串 */
export function decodeBase64(input: string): string {
  let s = input.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4;
  if (pad === 1) throw new Error('Base64 长度非法');
  if (pad) s += '='.repeat(4 - pad);
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** 尝试解码，失败返回 undefined（用于格式探测，不吞掉真正的业务错误） */
export function tryDecodeBase64(input: string): string | undefined {
  if (!/^[A-Za-z0-9+/=_\-\s]+$/.test(input)) return undefined;
  try {
    return decodeBase64(input);
  } catch {
    return undefined;
  }
}

export function encodeBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
