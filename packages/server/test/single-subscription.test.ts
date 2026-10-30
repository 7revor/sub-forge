import { stringify as testYaml } from 'yaml';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { detectClient } from '../src/client.ts';
import { Cipher } from '../src/crypto.ts';
import { Store } from '../src/store.ts';
import { addUser, client, setupApp, issueProfileToken } from './helpers.ts';

describe('每个用户一个资源令牌', () => {
  it('同用户多个订阅共用 token、跨用户隔离；删除订阅不撤销用户凭证', async () => {
    const h = setupApp();
    try {
      const a = await addUser(h.store, 'alice'), b = await addUser(h.store, 'bob');
      const alice = client(h.app), bob = client(h.app); await alice.login('alice'); await bob.login('bob');
      const one = (await alice.post('/api/profiles', { name: '订阅一', nodeSets: [] })).json.item;
      const two = (await alice.post('/api/profiles', { name: '订阅二', nodeSets: [] })).json.item;
      const first = (await alice.get(`/api/profiles/${one.id}/link`)).json.item;
      const second = (await alice.get(`/api/profiles/${two.id}/link`)).json.item;
      expect(first.token).toBe(second.token); expect(first.url).not.toBe(second.url);
      expect(first.token).toBe(h.store.userToken(a.id)!.token);
      expect(first.token).not.toBe(h.store.userToken(b.id)!.token);
      const repeats = await Promise.all(Array.from({ length: 6 }, () => alice.get(`/api/profiles/${one.id}/link`)));
      repeats.forEach(r => expect(r.json.item).toEqual(first));
      expect((await h.app.request(first.url.replace(first.token, h.store.userToken(b.id)!.token))).status).toBe(404);
      expect((await bob.get(`/api/profiles/${one.id}/link`)).status).toBe(404);
      expect((await alice.del(`/api/profiles/${one.id}`)).status).toBe(200);
      expect(h.store.getActiveToken(first.token)?.userId).toBe(a.id);
      expect((await h.app.request(first.url)).status).toBe(404);
      expect((await h.app.request(second.url)).status).toBe(200);
      const reset = await alice.post('/api/me/token/reset', { token: first.token });
      expect(reset.status).toBe(200); expect((await h.app.request(second.url)).status).toBe(404);
      expect((await h.app.request(second.url.replace(first.token, reset.json.item.token))).status).toBe(200);
      expect((await alice.post('/api/me/token/reset', { token: first.token })).status).toBe(409);
      expect((await alice.get(`/api/profiles/${two.id}/tokens`)).status).toBe(404);
    } finally { await h.snapshots.settled(); h.store.close(); }
  });
  it('同一链接按 UA 自动适配客户端，浏览器与未知客户端回落 Mihomo', async () => {
    const h = setupApp();
    try {
      h.store.put('profile', { id: 'p', name: '多客户端', nodeSets: [], overlay: {}, chains: [], refPolicy: { default: 'wrap' }, base: { kernels: {mihomo: testYaml({ 'mixed-port': 7890 }), stash: testYaml({ 'log-level': 'warning' }) } } });
      issueProfileToken(h.store, { token: 'test', profileId: 'p' });
      for (const ua of ['Stash/3.6.0', 'FlClash/v0.9.2 clash-verge Platform/android', 'clash-verge/v2.5.0', 'Mozilla/5.0', 'curl/8.0', 'Stash/4.3.0 (macOS)']) {
        const res = await h.app.request('/sub/test/p', { headers: { 'user-agent': ua } });
        expect(res.status).toBe(200); expect(res.headers.get('vary')).toBe('User-Agent');
        const body = parse(await res.text());
        if (ua.startsWith('Stash')) { expect(body['log-level']).toBe('warning'); expect(body).not.toHaveProperty('mixed-port'); }
        else expect(body['mixed-port']).toBe(7890);
      }
    } finally { await h.snapshots.settled(); h.store.close(); }
  });
  it('跨用户令牌冲突被拒绝，轮换和创建用户失败均原子回滚', () => {
    const store = new Store(':memory:');
    try {
      const a = store.createUser({ username: 'a', passwordHash: 'fixture', role: 'user' });
      const b = store.createUser({ username: 'b', passwordHash: 'fixture', role: 'user' });
      const token = store.userToken(a.id)!, other = store.userToken(b.id)!;
      expect(() => store.putToken({ token: token.token, userId: b.id })).toThrow('已被其他用户使用');
      expect(store.userToken(b.id)).toEqual(other);
      store.db.exec("CREATE TRIGGER fail_token BEFORE INSERT ON user_tokens BEGIN SELECT RAISE(ABORT, '测试写入失败'); END");
      expect(() => store.resetToken(token.token)).toThrow('测试写入失败'); expect(store.userToken(a.id)).toEqual(token);
      expect(() => store.createUser({ username: 'new', passwordHash: 'fixture', role: 'user' })).toThrow('测试写入失败');
      expect(store.getUserAuth('new')).toBeUndefined();
    } finally { store.close(); }
  });
  it('v22 升级撤销旧订阅凭证并清理旧配置，生成用户凭证后重启保持稳定', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-user-token-')), file = join(dir, 'db');
    const cipher = new Cipher(randomBytes(32)); let store = new Store(file, { cipher });
    try {
      const user = store.createUser({ username: 'alice', passwordHash: 'fixture', role: 'user' });
      store.put('profile', { id: 'p', name: '旧订阅', nodeSets: [], overlay: {}, chains: [], refPolicy: { default: 'wrap' } }, user.id);
      const before = store.getWithOwner('profile', 'p');
      store.putLastGood('p', 'mihomo:any', { yaml: '旧链接' });
      store.db.exec('DELETE FROM user_tokens; CREATE TABLE sub_tokens (token_hash TEXT PRIMARY KEY, token_enc TEXT NOT NULL, profile_id TEXT NOT NULL, label TEXT, created_at INTEGER NOT NULL)');
      store.db.prepare('INSERT INTO sub_tokens VALUES (?,?,?,?,?)').run(cipher.hmac('legacy'), cipher.encrypt('legacy'), 'p', null, 1);
      store.db.pragma('user_version = 22'); store.close(); store = new Store(file, { cipher });
      const token = store.userToken(user.id)!; expect(token.token).not.toBe('legacy'); expect(store.getToken('legacy')).toBeUndefined();
      expect(store.getWithOwner('profile', 'p')).toEqual(before); expect(store.getLastGood('p', 'mihomo:any')).toBeUndefined();
      expect(store.db.prepare("SELECT 1 FROM sqlite_master WHERE name='sub_tokens'").get()).toBeUndefined();
      store.close(); store = new Store(file, { cipher }); expect(store.userToken(user.id)).toEqual(token);
    } finally { store.close(); rmSync(dir, { recursive: true }); }
  });
});

it.each([
  ['Stash/3.6.0 CFNetwork/3860 Darwin/25.0.0', 'stash', 'ios'],
  ['Stash/4.3.0 (macOS)', 'stash', 'macos'],
  ['StashMac/4.3.0', 'stash', 'macos'],
  ['Stash/1.0 (tvOS)', 'stash', 'ios'],
  ['FlClash/v0.9.2 clash-verge Platform/windows', 'mihomo', 'windows'],
  ['ClashMetaForAndroid/2.11.5.Meta', 'mihomo', 'android'],
  ['clash-verge/v2.5.0', 'mihomo', undefined],
  ['clash.meta', 'mihomo', undefined],
])('请求头识别：%s', (ua, client, platform) => {
  expect(detectClient(ua, {})).toMatchObject({ client, by: 'ua', ...(platform ? { platform } : {}) });
});
