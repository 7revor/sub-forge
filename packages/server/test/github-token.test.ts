import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Cipher } from '../src/crypto.ts';
import { Store } from '../src/store.ts';
import { RuleRepoService } from '../src/rule-repos/service.ts';
import type { UpstreamFetcher } from '../src/net/upstream.ts';
import { addUser, client, setupApp } from './helpers.ts';

describe('GitHub 索引凭据', () => {
  it('仅管理员可配置、替换、清除，读取与写入响应不回显 Token', async () => {
    const h = setupApp();
    try {
      const c = client(h.app);
      expect((await c.get('/api/rule-repos/github-token')).status).toBe(401);
      await addUser(h.store, 'user'); await addUser(h.store, 'admin', 'admin');
      await c.login('user');
      expect((await c.get('/api/rule-repos/github-token')).status).toBe(403);
      expect((await c.put('/api/rule-repos/github-token', { token: 'test_token' })).status).toBe(403);
      expect((await c.del('/api/rule-repos/github-token')).status).toBe(403);
      await c.login('admin');
      expect((await c.get('/api/rule-repos/github-token')).json).toEqual({ configured: false });
      for (const token of ['test_token_one', 'test_token_two']) {
        const saved = await c.put('/api/rule-repos/github-token', { token: ` ${token} ` });
        expect(saved.status).toBe(200);
        expect(saved.json).toEqual({ configured: true });
        expect((await c.get('/api/rule-repos/github-token')).json).toEqual({ configured: true });
        expect((await c.get('/api/rule-repos')).text).not.toContain(token);
        expect(h.store.getGithubToken()).toBe(token);
        expect(JSON.stringify(h.store.db.prepare('SELECT * FROM server_secrets').all())).not.toContain(token);
      }
      for (const token of ['', 'Bearer test_token', 'bad\nheader', 'x'.repeat(513), null]) {
        expect((await c.put('/api/rule-repos/github-token', { token })).status).toBe(400);
      }
      expect(h.store.getGithubToken()).toBe('test_token_two');
      expect((await c.del('/api/rule-repos/github-token')).json).toEqual({ configured: false });
      expect(h.store.getGithubToken()).toBeUndefined();
      expect((await c.get('/api/rule-repos/github-token')).json).toEqual({ configured: false });
    } finally { h.store.close(); }
  });

  it('从 v11 升级，Token 加密保存并可在重启后读取', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sub-forge-token-'));
    const path = join(dir, 'test.db'); const cipher = new Cipher(randomBytes(32));
    let store = new Store(path, { cipher });
    try {
      store.db.exec('DROP TABLE server_secrets; PRAGMA user_version = 11');
      store.close(); store = new Store(path, { cipher });
      expect(store.getGithubToken()).toBeUndefined();
      store.setGithubToken('test_persisted_token');
      store.close(); store = new Store(path, { cipher });
      expect(store.db.pragma('user_version', { simple: true })).toBe(12);
      expect(store.getGithubToken()).toBe('test_persisted_token');
      expect((store.db.prepare('SELECT value FROM server_secrets').get() as { value: string }).value).not.toContain('test_persisted_token');
    } finally {
      store.close();
      for (const file of readdirSync(dir)) unlinkSync(join(dir, file));
      rmdirSync(dir);
    }
  });

  it('Token 变更即时作用于索引 API，不传给 README 和规则文件', async () => {
    const store = new Store(':memory:');
    const fetcher = vi.fn<UpstreamFetcher>(async url => {
      if (url.includes('/commits/')) return { status: 200, body: JSON.stringify({ sha: 'a'.repeat(40), commit: { tree: { sha: 'b'.repeat(40) } } }) };
      if (url.includes('/git/trees/')) return { status: 200, body: JSON.stringify({ truncated: false, tree: [{ path: 'rule/Surge/Test/Test.list', type: 'blob' }] }) };
      return { status: 200, body: url.endsWith('README.md') ? '' : 'DOMAIN,example.com' };
    });
    const repos = new RuleRepoService(store, fetcher);
    try {
      store.setGithubToken('test_first');
      await repos.refresh('blackmatrix7');
      await repos.detail('blackmatrix7', 'Test');
      const calls = fetcher.mock.calls;
      expect(calls.filter(([url]) => url.startsWith('https://api.github.com/')).length).toBeGreaterThan(1);
      expect(calls.filter(([url]) => url.startsWith('https://raw.githubusercontent.com/')).length).toBeGreaterThan(0);
      for (const [url, options] of calls) expect(options?.githubToken).toBe(url.startsWith('https://api.github.com/') ? 'test_first' : undefined);
      for (const token of ['test_second', undefined]) {
        store.setGithubToken(token); fetcher.mockClear(); await repos.refresh('blackmatrix7');
        expect(fetcher.mock.calls[0]?.[1]?.githubToken).toBe(token);
      }
    } finally { await repos.stop(); store.close(); }
  });
});
