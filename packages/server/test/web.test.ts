import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { RenderService } from '../src/render.ts';
import { SnapshotService } from '../src/snapshots.ts';
import { Store } from '../src/store.ts';

const base = mkdtempSync(join(tmpdir(), 'sf-web-'));
const dir = join(base, 'dist');
mkdirSync(join(dir, 'assets'), { recursive: true });
writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
writeFileSync(join(base, 'secret.txt'), 'top secret');
afterAll(() => rmSync(base, { recursive: true, force: true }));

const store = new Store(':memory:');
const snapshots = new SnapshotService(store, async () => { throw new Error('no network'); });
const app = createApp({ store, snapshots, renderer: new RenderService(store, snapshots, { publicUrl: 'https://sub.test' }), webDir: dir });

describe('托管前端', () => {
  it('静态资源带长缓存，前端路由回落到 index.html', async () => {
    const js = await app.request('/assets/app-abc123.js');
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toMatch(/javascript/);
    expect(js.headers.get('cache-control')).toMatch(/immutable/);
    for (const p of ['/', '/profiles/abc/groups', '/sources/new']) {
      const r = await app.request(p);
      expect(r.status).toBe(200);
      expect(r.headers.get('cache-control')).toBe('no-cache');
      expect(await r.text()).toContain('id="root"');
    }
  });

  it('接口路径不回落；不存在的资源 404；不能读到目录外的文件', async () => {
    const api = await app.request('/api/nope');
    expect([401, 404]).toContain(api.status);
    expect(await api.text()).not.toContain('id="root"');
    expect((await app.request('/sub/bad-token')).status).toBe(404);
    expect((await app.request('/assets/missing.js')).status).toBe(404);
    const escape = await app.request('/%2e%2e/secret.txt');
    expect(await escape.text()).not.toContain('top secret');
    expect((await app.request('/healthz')).status).toBe(200);
  });
});
