import { isIP } from 'node:net';

/** 只接受裸 IP；不把端口、域名、区域标识或任意请求头文本写进日志。 */
export function normalizeIp(value: string | undefined): string | undefined {
  if (!value || value.includes('%') || !isIP(value)) return undefined;
  if (isIP(value) === 4) return value;
  const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(canonical);
  if (!mapped) return canonical;
  const high = parseInt(mapped[1]!, 16), low = parseInt(mapped[2]!, 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}
