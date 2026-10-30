import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { detectClient } from '../src/client.ts';
import { Cipher } from '../src/crypto.ts';
import { Store } from '../src/store.ts';
import { addUser, client, setupApp } from './helpers.ts';

describe('每个订阅使用一个全局唯一链接', () => {
  it('保存即生成，重复保存、并发获取不改变链接，复制与其他用户不共用令牌', async () => {
    const h = setupApp();
    try {
      await addUser(h.store, 'alice'); await addUser(h.store, 'bob');
      const alice = client(h.app), bob = client(h.app);
      await alice.login('alice'); await bob.login('bob');
      const draft = { name: '唯一链接', nodeSets: [] };
      const saved = (await alice.post('/api/profiles', draft)).json.item;
      const [first] = (await alice.get(`/api/profiles/${saved.id}/tokens`)).json.items;
      expect(first.url).toMatch(/^https:\/\/sub\.test\/sub\/[\w-]+$/);
      expect((await alice.put(`/api/profiles/${saved.id}`, { ...saved, name: '修改名称' })).status).toBe(200);
      const repeats = await Promise.all(Array.from({ length: 6 }, () => alice.post(`/api/profiles/${saved.id}/tokens`)));
      repeats.forEach(r => expect(r.json.item).toEqual(first));
      const duplicate = (await alice.post('/api/profiles', draft)).json.item;
      const other = (await bob.post('/api/profiles', draft)).json.item;
      expect(new Set([first.token, h.store.listTokens(duplicate.id)[0]!.token, h.store.listTokens(other.id)[0]!.token]).size).toBe(3);
      expect((await bob.get(`/api/profiles/${saved.id}/tokens`)).status).toBe(404);
      expect((await bob.post(`/api/profiles/${saved.id}/tokens/${first.token}/reset`)).status).toBe(404);
      expect((await alice.del(`/api/profiles/${saved.id}`)).status).toBe(200);
      expect(h.store.listTokens(saved.id)).toEqual([]);
      expect((await h.app.request(`/sub/${first.token}`)).status).toBe(404);
    } finally { await h.snapshots.settled(); h.store.close(); }
  });

  it('同一链接按 UA 返回独立客户端配置，浏览器与未知客户端回落 Mihomo', async () => {
    const h = setupApp();
    try {
      h.store.put('profile', { id: 'p', name: '多客户端', nodeSets: [], overlay: {}, chains: [], refPolicy: { default: 'wrap' },
        base: { patch: { 'mixed-port': 7890 }, stashPatch: { 'log-level': 'warning' } },
        routing: { mode: 'independent', config: { groups: [], rules: [], final: { kind: 'builtin', name: 'DIRECT' } } },
      });
      const url = `/sub/${h.store.listTokens('p')[0]!.token}`;
      for (const ua of ['Stash/3.6.0', 'FlClash/v0.9.2 clash-verge Platform/android', 'clash-verge/v2.5.0', 'Mozilla/5.0', 'curl/8.0', 'Stash/4.3.0 (macOS)']) {
        const res = await h.app.request(url, { headers: { 'user-agent': ua } });
        expect(res.status).toBe(200);
        expect(res.headers.get('vary')).toBe('User-Agent');
        const body = parse(await res.text());
        if (ua.startsWith('Stash')) {
          expect(body['log-level']).toBe('warning');
          expect(body).not.toHaveProperty('mixed-port');
        } else expect(body['mixed-port']).toBe(7890);
      }
      expect(h.store.listTokens('p')).toHaveLength(1);
    } finally { await h.snapshots.settled(); h.store.close(); }
  });

  it('跨订阅令牌冲突和轮换失败均回滚，保留原链接', () => {
    const store = new Store(':memory:');
    try {
      const a = store.createToken('a'), b = store.createToken('b');
      expect(() => store.putToken({ token: a.token, profileId: 'b' })).toThrow('已被其他订阅使用');
      expect(store.listTokens('b')).toEqual([b]);
      store.db.exec("CREATE TRIGGER fail_token BEFORE INSERT ON sub_tokens BEGIN SELECT RAISE(ABORT, '测试写入失败'); END");
      expect(() => store.resetToken(a.token)).toThrow('测试写入失败');
      expect(store.listTokens('a')).toEqual([a]);
      expect(() => store.put('profile', { id: 'new', name: '新订阅', nodeSets: [], overlay: {}, chains: [], refPolicy: { default: 'wrap' } })).toThrow('测试写入失败');
      expect(store.get('profile', 'new')).toBeUndefined();
    } finally { store.close(); }
  });

  it('v21 多链接保留最早一条，无链接自动补齐，重启稳定且数据库拒绝重复', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-single-sub-'));
    const file = join(dir, 'test.db'), cipher = new Cipher(randomBytes(32));
    let store = new Store(file, { cipher, now: () => 100 });
    try {
      for (const id of ['multiple', 'empty']) store.put('profile', { id, name: id, nodeSets: [], overlay: {}, chains: [], refPolicy: { default: 'wrap' } }, 'owner');
      store.db.exec('DROP INDEX sub_tokens_one_per_profile; DELETE FROM sub_tokens');
      const insert = () => store.db.prepare('INSERT INTO sub_tokens VALUES (?, ?, ?, ?, ?)');
      insert().run(cipher.hmac('early'), cipher.encrypt('early'), 'multiple', '最早链接', 1);
      insert().run(cipher.hmac('later'), cipher.encrypt('later'), 'multiple', '后续链接', 2);
      const before = store.getWithOwner('profile', 'multiple');
      store.db.pragma('user_version = 21'); store.close();
      store = new Store(file, { cipher });
      const kept = store.listTokens('multiple'), added = store.listTokens('empty');
      expect(kept).toEqual([{ token: 'early', profileId: 'multiple', label: '最早链接', createdAt: 1 }]);
      expect(added).toHaveLength(1);
      expect(store.getToken('later')).toBeUndefined();
      expect(store.getWithOwner('profile', 'multiple')).toEqual(before);
      expect(() => insert().run(cipher.hmac('extra'), cipher.encrypt('extra'), 'multiple', null, 3)).toThrow(/UNIQUE/);
      store.close(); store = new Store(file, { cipher });
      expect(store.listTokens('multiple')).toEqual(kept);
      expect(store.listTokens('empty')).toEqual(added);
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
  expect(detectClient(ua, {})).toEqual({ client, by: 'ua', ...(platform ? { platform } : {}) });
});
