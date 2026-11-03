import { afterEach, describe, expect, it, vi } from 'vitest';
import { cacheCycleStart, nextCacheExpiry } from '../src/cache-cycle.ts';

const HOUR = 3600, DAY = 24 * HOUR;
const local = (y: number, m: number, d: number, h = 0, min = 0, s = 0, ms = 0) => new Date(y, m - 1, d, h, min, s, ms).getTime();

describe('全局缓存周期', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('24 小时周期对齐本地 0 点', () => {
    const midnight = local(2026, 11, 3);
    expect(cacheCycleStart(local(2026, 11, 3, 15, 30), DAY)).toBe(midnight);
    expect(nextCacheExpiry(local(2026, 11, 3, 15, 30), DAY)).toBe(midnight + DAY * 1000);
  });

  it('跟随进程时区：上海 0 点是 UTC 前一天 16 点', () => {
    vi.stubEnv('TZ', 'Asia/Shanghai');
    expect(cacheCycleStart(Date.UTC(2026, 10, 3, 3), DAY)).toBe(Date.UTC(2026, 10, 2, 16));
    vi.stubEnv('TZ', 'UTC');
    expect(cacheCycleStart(Date.UTC(2026, 10, 3, 3), DAY)).toBe(Date.UTC(2026, 10, 3));
  });

  it('1 小时周期对齐整点', () => {
    expect(cacheCycleStart(local(2026, 11, 3, 15, 59, 59), HOUR)).toBe(local(2026, 11, 3, 15));
  });

  it('不整除 24 的周期按相同算法连续切分', () => {
    const ttl = 7 * HOUR, now = local(2026, 11, 3, 15, 30);
    const start = cacheCycleStart(now, ttl);
    expect(start).toBeLessThanOrEqual(now);
    expect(now - start).toBeLessThan(ttl * 1000);
    expect(cacheCycleStart(start + ttl * 1000 - 1, ttl)).toBe(start);
    expect(cacheCycleStart(start + ttl * 1000, ttl)).toBe(start + ttl * 1000);
  });

  it('边界前后 1 毫秒落在不同周期', () => {
    const midnight = local(2026, 11, 3);
    expect(cacheCycleStart(midnight - 1, DAY)).toBe(midnight - DAY * 1000);
    expect(cacheCycleStart(midnight, DAY)).toBe(midnight);
    expect(cacheCycleStart(midnight + 1, DAY)).toBe(midnight);
  });
});
