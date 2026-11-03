// 上游缓存分层：缓存只属于上游，下游是纯函数。覆盖 docs/23 第 7 节列出的跨层用例。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { remoteRuleMatcher, type Matcher } from '@sub-forge/core';
import { Cipher } from '../src/crypto.ts';
import { MAX_UPSTREAM_READS } from '../src/snapshots.ts';
import { SCHEMA_VERSION } from '../src/schema.ts';
import { Store } from '../src/store.ts';
import { setupApp } from './helpers.ts';

const DAY = 86400_000;
const RULE = 'https://rules.test/shared.list', NODE = 'https://nodes.test/a';
const direct = { kind: 'builtin' as const, name: 'DIRECT' as const };
const envs: ReturnType<typeof setupApp>[] = [];
afterEach(async () => { for (const h of envs.splice(0)) { await h.snapshots.settled(); h.store.close(); } });

function setup() {
  let now = new Date(2026, 10, 3, 1).getTime();
  const state = { rule: 'DOMAIN,one.test' as string | Error, node: 'trojan://p@n.test:443#节点' as string | Error };
  const fetcher = vi.fn(async (url: string) => {
    const body = url.includes('nodes') ? state.node : state.rule;
    if (body instanceof Error) throw body;
    return { status: 200, body };
  });
  const h = setupApp({ fetcher, now: () => now }); envs.push(h);
  const a = h.store.createUser({ username: 'a', passwordHash: 'x', role: 'admin' }), b = h.store.createUser({ username: 'b', passwordHash: 'x', role: 'user' });
  const profile = (id: string, owner: string, matcher: Matcher, nodeSets: { ref: { type: 'source'; id: string }; output: 'provider' }[] = []) => h.store.put('profile', {
    id, name: id, nodeSets, chains: [], routing: { mode: 'independent', config: { groups: [], rules: [{ id: 'r', matcher, target: direct }], final: direct } },
  }, owner);
  const main = async (token: string, id: string) => { const res = await h.app.request(`/subs/profile?token=${token}&id=${id}`); expect(res.status).toBe(200); return parse(await res.text()); };
  const ruleCount = () => (h.store.db.prepare("SELECT COUNT(*) AS n FROM snapshots WHERE owner_kind = 'ruleset'").get() as { n: number }).n;
  return { ...h, a, b, tokenA: h.store.userToken(a.id)!.token, tokenB: h.store.userToken(b.id)!.token, state, fetcher, profile, main, ruleCount, tick: (ms: number) => { now += ms; } };
}
const ruleUrl = (config: any): string => Object.values<{ url: string }>(config['rule-providers'])[0]!.url;

it('主配置不读取任何规则：上游调用次数为 0，规则文件请求才读取', async () => {
  const h = setup(); h.profile('p', h.a.id, remoteRuleMatcher(RULE));
  const config = await h.main(h.tokenA, 'p');
  expect(h.fetcher).not.toHaveBeenCalled(); expect(h.ruleCount()).toBe(0);
  expect((await h.app.request(ruleUrl(config))).status).toBe(200);
  expect(h.fetcher).toHaveBeenCalledTimes(1);
});

it('同一 URL 被模板、多个订阅和增强引用时只存一份、只拉一次；读取参数不同各存一份', async () => {
  const h = setup(), matcher = remoteRuleMatcher(RULE);
  h.store.putTemplate({ id: 't', name: '模板', groups: [], rules: [{ id: 'r', matcher, target: direct }], final: direct });
  h.store.put('ruleset', { id: 'enhance', name: '增强', sources: [{ id: 's', kind: 'remote', url: RULE, format: 'auto' }] }, h.a.id);
  const urls: string[] = [];
  for (const id of ['p1', 'p2', 'p3']) { h.profile(id, h.a.id, matcher); urls.push(ruleUrl(await h.main(h.tokenA, id))); }
  h.store.put('profile', { id: 'bound', name: 'bound', nodeSets: [], chains: [], routing: { mode: 'bound', templateId: 't', groupAdditions: {}, extraGroups: [] } }, h.a.id);
  urls.push(ruleUrl(await h.main(h.tokenA, 'bound')));
  h.profile('e', h.a.id, { kind: 'ruleset', id: 'enhance' }); urls.push(ruleUrl(await h.main(h.tokenA, 'e')));
  for (const url of urls) expect(await (await h.app.request(url)).text()).toBe('DOMAIN,one.test\n');
  expect(h.fetcher).toHaveBeenCalledTimes(1); expect(h.ruleCount()).toBe(1);
  await h.snapshots.getRuleContent(RULE, { ua: '其他 UA' });
  expect(h.fetcher).toHaveBeenCalledTimes(2); expect(h.ruleCount()).toBe(2);
});

it('规则跨周期立刻失效且失败不返回旧内容；失败不写表，恢复后下次请求成功', async () => {
  const h = setup(); h.profile('p', h.a.id, remoteRuleMatcher(RULE));
  const url = ruleUrl(await h.main(h.tokenA, 'p'));
  expect((await h.app.request(url)).status).toBe(200);
  h.tick(DAY); h.state.rule = new Error('上游故障'); h.fetcher.mockClear();
  for (let i = 1; i <= 2; i++) {
    const res = await h.app.request(url);
    expect(res.status).toBe(503); expect(await res.text()).not.toContain('one.test');
    expect(h.fetcher).toHaveBeenCalledTimes(i); // 没有退避
  }
  expect(h.store.db.prepare("SELECT COUNT(*) AS n FROM snapshots WHERE owner_kind = 'ruleset' AND ok = 0").get()).toEqual({ n: 0 });
  h.state.rule = 'DOMAIN,two.test';
  expect(await (await h.app.request(url)).text()).toBe('DOMAIN,two.test\n');
  expect(h.ruleCount()).toBe(1);
});

it('修改周期设置后立即按新周期判定', async () => {
  const h = setup();
  await h.snapshots.getRuleContent(RULE);
  h.tick(3600_000);
  await h.snapshots.getRuleContent(RULE); expect(h.fetcher).toHaveBeenCalledTimes(1);
  h.store.setResourceCacheTtlSec(3600);
  await h.snapshots.getRuleContent(RULE); expect(h.fetcher).toHaveBeenCalledTimes(2);
});

it('权限在入口校验：其他用户不能通过 /subs/ruleset 读到别人配置的远端规则，即使缓存已存在', async () => {
  const h = setup(); h.profile('p', h.a.id, remoteRuleMatcher(RULE));
  const url = ruleUrl(await h.main(h.tokenA, 'p'));
  expect((await h.app.request(url)).status).toBe(200);
  expect(h.ruleCount()).toBe(1);
  expect((await h.app.request(url.replace(h.tokenA, h.tokenB))).status).toBe(404);
});

it('节点订阅故障时，专属规则和公共规则文件仍能下发，且不读节点上游', async () => {
  const h = setup(); h.state.node = new Error('节点上游故障');
  h.store.put('source', { id: 's', name: '源', url: NODE, pipeline: [] }, h.a.id);
  const nodeSets = [{ ref: { type: 'source' as const, id: 's' }, output: 'provider' as const }];
  h.profile('p', h.a.id, remoteRuleMatcher(RULE), nodeSets);
  h.store.put('ruleset', { id: 'r', name: '公共', sources: [{ id: 's', kind: 'remote', url: RULE, format: 'auto' }] }, h.a.id);
  const render = h.renderer as unknown as { render: (...args: unknown[]) => unknown }, renderSpy = vi.spyOn(render, 'render');
  const key = (h.renderer as unknown as { ruleKey(reference: unknown, target: unknown): string }).ruleKey({ matcher: remoteRuleMatcher(RULE) }, { client: 'mihomo' });
  const exclusive = await h.app.request(`/subs/ruleset?profile=p&key=${key}&target=mihomo&token=${h.tokenA}`);
  expect(exclusive.status).toBe(200); expect(await exclusive.text()).toBe('DOMAIN,one.test\n');
  const shared = await h.app.request(`/resources/ruleset?id=r&target=mihomo&format=text&token=${h.tokenA}`);
  expect(shared.status).toBe(200);
  expect(renderSpy).not.toHaveBeenCalled();
  expect(h.fetcher.mock.calls.map(([url]) => url)).toEqual([RULE]);
});

it('Loon 手写规则走 /subs/ruleset 也不渲染整个配置，地址失效返回 404', async () => {
  const h = setup();
  h.profile('p', h.a.id, { kind: 'rule', rule: { type: 'DOMAIN', value: 'loon.test' } } as Matcher);
  const res = await h.app.request(`/subs/profile?token=${h.tokenA}&id=p&target=loon&platform=ios`);
  expect(res.status).toBe(200);
  const line = (await res.text()).match(/https:\/\/sub\.test\/subs\/ruleset[^\s,]+/)![0];
  const file = await h.app.request(line);
  expect(file.status).toBe(200); expect(await file.text()).toContain('loon.test');
  expect(h.fetcher).not.toHaveBeenCalled();
  expect((await h.app.request(line.replace(/key=[^&]+/, `key=${'0'.repeat(64)}`))).status).toBe(404);
});

it('预览并行读取规则来源，正文齐全；单个来源失败报告错误', async () => {
  const h = setup(); let active = 0, peak = 0;
  h.fetcher.mockImplementation(async (url: string) => {
    peak = Math.max(peak, ++active); await new Promise(resolve => setTimeout(resolve, 5)); active--;
    if (url.includes('bad')) throw new Error('来源失败');
    return { status: 200, body: 'DOMAIN,one.test' };
  });
  h.store.put('ruleset', { id: 'r', name: '多来源', sources: ['a', 'b', 'c'].map(id => ({ id, kind: 'remote' as const, url: `https://rules.test/${id}`, format: 'auto' as const })) }, h.a.id);
  h.profile('p', h.a.id, { kind: 'ruleset', id: 'r' });
  expect((await h.renderer.preview('p', { client: 'mihomo' })).ok).toBe(true);
  expect(peak).toBe(3);
  h.store.put('ruleset', { id: 'r', name: '多来源', sources: [{ id: 'bad', kind: 'remote', url: 'https://rules.test/bad', format: 'auto' }] }, h.a.id);
  const failed = await h.renderer.preview('p', { client: 'mihomo' });
  expect(failed.ok).toBe(false);
  expect(failed.report).toContainEqual(expect.objectContaining({ code: 'ruleset.fetch-failed', level: 'error' }));
});

it('全局并发上限对节点和规则共同生效，排队不影响相同身份合并', async () => {
  const h = setup(); let active = 0, peak = 0;
  const release: (() => void)[] = [];
  h.fetcher.mockImplementation(async () => {
    peak = Math.max(peak, ++active); await new Promise<void>(resolve => release.push(resolve)); active--;
    return { status: 200, body: 'DOMAIN,one.test' };
  });
  const urls = Array.from({ length: MAX_UPSTREAM_READS + 4 }, (_, i) => `https://rules.test/${i}`);
  const reads = [...urls, ...urls].map(url => h.snapshots.getRuleContent(url));
  await vi.waitFor(() => expect(release.length).toBe(MAX_UPSTREAM_READS));
  while (release.length) { release.shift()!(); await new Promise(resolve => setTimeout(resolve)); }
  await Promise.all(reads);
  expect(peak).toBe(MAX_UPSTREAM_READS);
  expect(h.fetcher).toHaveBeenCalledTimes(urls.length);
});

it('节点手动刷新绕过周期判定', async () => {
  const h = setup();
  h.store.put('source', { id: 's', name: '源', url: NODE, pipeline: [] }, h.a.id);
  const source = { id: 's', url: NODE };
  await h.snapshots.getNodeSource(source);
  await h.snapshots.getNodeSource(source); expect(h.fetcher).toHaveBeenCalledTimes(1);
  await h.snapshots.refreshNodeSource(source); expect(h.fetcher).toHaveBeenCalledTimes(2);
});

const LEGACY_BINDINGS = `CREATE TABLE resource_bindings (kind TEXT NOT NULL, id TEXT NOT NULL, url_hash TEXT NOT NULL, resource TEXT NOT NULL, PRIMARY KEY(kind,id,url_hash));`;

it.each([
  ['带密文和绑定的 v34', 34, true],
  ['明文但带绑定的旧库', 34, false],
])('迁移：%s 升级后节点快照可读，规则快照清除，绑定表删除，重启幂等', (_name, version, encrypted) => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-cache-migration-')), file = join(dir, 'old.db');
  const cipher = new Cipher(randomBytes(32)), url = 'https://nodes.test/shared';
  const text = (value: string) => encrypted ? cipher.encrypt(value) : value;
  try {
    const old = new Store(file, { cipher });
    for (const id of ['a', 'b', 'gone-url']) old.put('source', { id, name: id, url: id === 'gone-url' ? 'https://nodes.test/changed' : url, pipeline: [] });
    old.db.exec(LEGACY_BINDINGS);
    const hash = cipher.hmac(url), insert = old.db.prepare('INSERT INTO snapshots (owner_kind, owner_id, url, url_hash, fetched_at, ok, body, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    insert.run('source', 'resource:shared', text(url), hash, 10, 1, text('节点正文'), null);
    insert.run('source', 'resource:shared', text(url), hash, 20, 0, null, text('最近失败'));
    insert.run('source', 'resource:orphan', text(url), hash, 10, 1, text('无绑定'), null);
    insert.run('source', 'gone-url', text(url), hash, 10, 1, text('旧地址'), null);
    insert.run('ruleset', 'resource:rule', text('https://r.test'), cipher.hmac('https://r.test'), 10, 1, text('DOMAIN,a.test'), null);
    const bind = old.db.prepare('INSERT INTO resource_bindings VALUES (?, ?, ?, ?)');
    bind.run('source', 'a', hash, 'resource:shared'); bind.run('source', 'b', hash, 'resource:shared'); bind.run('source', 'deleted', hash, 'resource:shared');
    bind.run('ruleset', 'r', cipher.hmac('https://r.test'), 'resource:rule');
    if (encrypted) for (const row of old.db.prepare("SELECT id, data FROM docs WHERE kind = 'source'").all() as { id: string; data: string }[]) old.db.prepare("UPDATE docs SET data = ? WHERE kind = 'source' AND id = ?").run(cipher.encrypt(JSON.stringify({ id: row.id, name: row.id, url: row.id === 'gone-url' ? 'https://nodes.test/changed' : url, pipeline: [] })), row.id);
    old.db.pragma(`user_version = ${version}`);
    old.close();
    for (let i = 0; i < 2; i++) {
      const s = new Store(file, { cipher });
      expect(s.db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
      expect(s.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'resource_bindings'").get()).toBeUndefined();
      for (const id of ['a', 'b']) {
        expect(s.latestSnapshot('source', id, url)?.body).toBe('节点正文');
        expect(s.latestSnapshot('source', id, url, false)?.error).toBe('最近失败');
      }
      expect(s.db.prepare("SELECT COUNT(*) AS n FROM snapshots WHERE owner_kind = 'ruleset'").get()).toEqual({ n: 0 });
      expect(s.db.prepare("SELECT COUNT(*) AS n FROM snapshots WHERE owner_id NOT IN ('a','b')").get()).toEqual({ n: 0 });
      s.close();
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
