import { afterEach, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { queryUrl, remoteRuleMatcher } from '@sub-forge/core';
import { Cipher } from '../src/crypto.ts';
import { Store } from '../src/store.ts';
import { setupApp } from './helpers.ts';

const envs: ReturnType<typeof setupApp>[] = [];
afterEach(async () => { for (const h of envs.splice(0)) { await h.snapshots.settled(); h.store.close(); } });
function setup() {
  const fetcher = vi.fn(async () => ({ status: 200, body: 'DOMAIN,private.test' }));
  const h = setupApp({ fetcher }); envs.push(h);
  const owner = h.store.createUser({ username: 'owner', passwordHash: 'fixture', role: 'admin' }), other = h.store.createUser({ username: 'other', passwordHash: 'fixture', role: 'user' });
  const token = h.store.userToken(owner.id)!.token, otherToken = h.store.userToken(other.id)!.token;
  const session = h.store.createSession(owner.id, 3600000), headers = { cookie: `sf_session=${session}` };
  const config = { groups: [], rules: [{ id: 'r', matcher: remoteRuleMatcher('https://private.test/rules'), target: { kind: 'builtin' as const, name: 'DIRECT' as const } }], final: { kind: 'builtin' as const, name: 'DIRECT' as const } };
  h.store.put('profile', { id: 'p', name: '订阅', nodeSets: [], chains: [], overlay: {}, refPolicy: { default: 'wrap' }, routing: { mode: 'independent', config } }, owner.id);
  const main = queryUrl('/subs/profile', { id: 'p', token });
  const ruleLink = async () => {
    const response = await h.app.request(main); expect(response.status).toBe(200);
    return Object.values<{ url: string }>(parse(await response.text())['rule-providers'])[0]!.url;
  };
  return { ...h, owner, other, token, otherToken, headers, session, config, main, ruleLink, fetcher };
}

it('管理 GET 只使用登录态，文件 GET 只使用 token；旧入口和动态路径全部停止服务', async () => {
  const h = setup();
  expect((await h.app.request('/api/profiles?id=p', { headers: h.headers })).status).toBe(200);
  expect((await h.app.request(`/api/profiles?id=p&token=${h.token}`)).status).toBe(401);
  expect((await h.app.request(`/api/profiles?id=p&token=${h.token}`, { headers: h.headers })).status).toBe(400);
  expect((await h.app.request('/subs/profile?id=p', { headers: h.headers })).status).toBe(404);
  for (const path of [`/sub/${h.token}/p`, `/p/${h.token}/p/k`, `/r/${h.token}/k`, `/rules/${h.token}/r`, `/nodes/${h.token}/source/s`, `/api/files/${h.token}/templates/t/rules/r`, '/api/profiles/p', '/api/profiles/p/link', '/api/templates/t', '/subs/templates', '/resources/templates']) {
    expect((await h.app.request(path, { headers: h.headers })).status, path).toBe(404);
  }
  expect((await h.app.request('/api/auth/login', { method: 'POST', headers: h.headers })).status).toBe(404);
  expect((await h.app.request('/api/profiles?id=p&id=other', { headers: h.headers })).status).toBe(400);
  const apiDir = new URL('../src/api/', import.meta.url);
  const texts = readdirSync(apiDir).filter(name => name.endsWith('.ts')).map(name => readFileSync(new URL(name, apiDir), 'utf8'));
  texts.push(readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8'));
  expect(texts.join('\n')).not.toMatch(/\.get\(['`][^\n]*\/:\w/);
});

it('专属规则按订阅隔离原文及产物，客户端格式变化不改变权限；配置移除规则即清理历史正文', async () => {
  const h = setup(), first = await h.ruleLink();
  h.store.put('profile', { ...h.store.get('profile', 'p')!, id: 'second' }, h.other.id);
  const second = await h.app.request(queryUrl('/subs/profile', { id: 'second', token: h.otherToken, target: 'stash' }));
  const secondLink = Object.values<{ url: string }>(parse(await second.text())['rule-providers'])[0]!.url;
  expect((await h.app.request(secondLink.replace(h.otherToken, h.token))).status).toBe(404);
  expect((await h.app.request(first.replace(h.token, h.otherToken))).status).toBe(404);
  expect(h.store.listSharedRules()).toEqual([]); expect(h.fetcher).toHaveBeenCalledTimes(2);
  h.store.put('profile', { ...h.store.get('profile', 'p')!, routing: { mode: 'independent', config: { ...h.config, rules: [] } } }, h.owner.id);
  expect((await h.app.request(first)).status).toBe(404);
  expect(h.store.getLastGood<{ privateRules: object }>('p', 'mihomo:any')?.data.privateRules).toEqual({});
  expect((await h.app.request(secondLink)).status).toBe(200);
  expect(h.store.db.prepare('SELECT COUNT(*) AS n FROM resource_bindings').get()).toEqual({ n: 1 });
});

it.each(['delete', 'recreate', 'remove-rule', 'reset', 'disable'])('专属规则刷新在途 %s 后不返回旧正文或复活已删除缓存', async action => {
  const h = setup(), url = await h.ruleLink();
  let entered!: () => void, release!: () => void;
  const began = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  h.fetcher.mockImplementation(async () => { entered(); await gate; return { status: 200, body: 'DOMAIN,late.test' }; });
  h.advance(86400001); const request = h.app.request(url); await began;
  if (action === 'delete' || action === 'recreate') {
    const profile = h.store.get('profile', 'p')!; h.store.delete('profile', 'p');
    if (action === 'recreate') h.store.put('profile', profile, h.owner.id);
  }
  if (action === 'remove-rule') h.store.put('profile', { ...h.store.get('profile', 'p')!, routing: { mode: 'independent', config: { ...h.config, rules: [] } } }, h.owner.id);
  if (action === 'reset') h.store.resetToken(h.token);
  if (action === 'disable') h.store.updateUser(h.owner.id, { disabled: true });
  release(); const response = await request;
  expect(response.status).toBe(404); expect(await response.text()).not.toContain('late.test');
  if (action === 'delete' || action === 'remove-rule') {
    expect(h.store.db.prepare('SELECT * FROM resource_bindings').all()).toEqual([]);
    expect(h.store.db.prepare('SELECT * FROM snapshots').all()).toEqual([]);
  }
});

it('升级清空旧地址配置和公共远程引用，不变更用户 token；重启幂等', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-query-migration-')), file = join(dir, 'test.db');
  const cipher = new Cipher(Buffer.alloc(32, 7));
  let store = new Store(file, { cipher });
  try {
    const owner = store.createUser({ username: 'a', passwordHash: 'fixture', role: 'user' });
    const token = store.userToken(owner.id)!.token;
    const matcher = remoteRuleMatcher('https://private.test/old');
    store.putSharedRule('old', matcher.id, { reference: { matcher }, target: { client: 'mihomo' }, body: 'DOMAIN,private.test' });
    store.putLastGood('p', 'mihomo:any', { yaml: '旧路径配置' });
    store.db.pragma('user_version = 24'); store.close(); store = new Store(file, { cipher });
    expect(store.userToken(owner.id)!.token).toBe(token); expect(store.listSharedRules()).toEqual([]);
    expect(store.getLastGood('p', 'mihomo:any')).toBeUndefined();
    store.close(); store = new Store(file, { cipher }); expect(store.userToken(owner.id)!.token).toBe(token);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
