// 管理接口测试用的小工具：带 cookie 的请求客户端、内存数据库上的完整应用。

import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/crypto.ts';
import type { UpstreamFetcher } from '../src/net/upstream.ts';
import { RenderService } from '../src/render.ts';
import { SnapshotService } from '../src/snapshots.ts';
import { Store, type Role } from '../src/store.ts';

export function setupApp(opts: { fetcher?: UpstreamFetcher; now?: () => number } = {}) {
  let t = 1_700_000_000_000;
  const now = opts.now ?? (() => t);
  const store = new Store(':memory:', { now });
  const fetcher: UpstreamFetcher = opts.fetcher ?? (async (url) => { throw new Error(`测试中未提供 ${url}`); });
  const snapshots = new SnapshotService(store, fetcher, now);
  const renderer = new RenderService(store, snapshots, { publicUrl: 'https://sub.test' });
  const app = createApp({ store, renderer, snapshots, now, publicUrl: 'https://sub.test' });
  return { store, app, snapshots, renderer, advance: (ms: number) => { t += ms; } };
}

export async function addUser(store: Store, username: string, role: Role = 'user', password = 'password-123') {
  return store.createUser({ username, passwordHash: await hashPassword(password), role });
}

/** 模拟浏览器：保存 Set-Cookie，后续请求带上 */
export function client(app: ReturnType<typeof setupApp>['app']) {
  let cookie = '';
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.request(path, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const set = res.headers.get('set-cookie');
    if (set) {
      const m = /sf_session=([^;]*)/.exec(set);
      if (m) cookie = m[1] ? `sf_session=${m[1]}` : '';
    }
    const text = await res.text();
    let json: any;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
    return { status: res.status, json, text, headers: res.headers };
  };
  return {
    get: (p: string) => call('GET', p),
    post: (p: string, b?: unknown, h?: Record<string, string>) => call('POST', p, b ?? {}, h),
    put: (p: string, b: unknown) => call('PUT', p, b),
    patch: (p: string, b: unknown) => call('PATCH', p, b),
    del: (p: string) => call('DELETE', p),
    raw: call,
    login: async (username: string, password = 'password-123') => call('POST', '/api/auth/login', { username, password }),
  };
}
