export function formatTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatBytes(n?: number): string {
  if (n === undefined) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}

/** 用户页保留“至少 1 分钟前”的展示习惯，其余页面使用“刚刚”。 */
export function formatRelativeTime(ms: number, options: { justNow?: boolean; now?: number } = {}): string {
  const elapsed = Math.max(0, (options.now ?? Date.now()) - ms);
  if (elapsed < 60_000 && options.justNow !== false) return '刚刚';
  if (elapsed < 3_600_000) return `${Math.max(1, Math.floor(elapsed / 60_000))} 分钟前`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;
  return formatTime(ms).slice(5);
}
