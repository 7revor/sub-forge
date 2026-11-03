// 系统只有一个缓存周期：快照的拉取时间早于当前周期开始时间就算过期。

/** 按服务器本地时区对齐：24 小时周期落在每天 0 点。 */
export function cacheCycleStart(now: number, ttlSec: number): number {
  const ttl = ttlSec * 1000;
  const offset = new Date(now).getTimezoneOffset() * 60_000;
  return Math.floor((now - offset) / ttl) * ttl + offset;
}

/** 当前周期结束、缓存下次失效的时间。 */
export function nextCacheExpiry(now: number, ttlSec: number): number {
  return cacheCycleStart(now, ttlSec) + ttlSec * 1000;
}
