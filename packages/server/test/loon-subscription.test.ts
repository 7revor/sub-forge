import { afterEach, describe, expect, it, vi } from 'vitest';
import { remoteRuleMatcher } from '@sub-forge/core';
import { detectClient } from '../src/client.ts';
import { RenderService } from '../src/render.ts';
import { addUser, client, setupApp } from './helpers.ts';
const envs: ReturnType<typeof setupApp>[] = [];
afterEach(async () => { for (const h of envs.splice(0)) { await h.snapshots.settled(); h.store.close(); } });
async function scenario() {
  const url = 'https://rules.example.test/loon.list';
  const h = setupApp({ fetcher: async input => {
    if (input !== url) throw new Error('未声明的测试地址');
    return { status: 200, body: 'DOMAIN,remote.test\nIP-CIDR,192.0.2.0/24,no-resolve' };
  } });
  envs.push(h);
  const user = await addUser(h.store, 'alice', 'admin'), alice = client(h.app); await alice.login('alice');
  await addUser(h.store, 'bob'); const bob = client(h.app); await bob.login('bob');
  h.store.put('preset', { id: 'base', name: '隔离预设', version: 1, mihomo: { 'mixed-port': 7890 }, surge: { general: { loglevel: 'notify' } }, loon: { general: { 'ip-mode': 'v4-only', 'allow-wifi-access': false } } }, user.id);
  h.store.put('local', { id: 'nodes', name: '节点', proxies: [{ name: '节点', type: 'trojan', server: 'example.test', port: 443, password: 'example' }] }, user.id);
  const draft = { name: 'Loon', nodeSets: [{ ref: { type: 'local', id: 'nodes' }, output: 'provider' }], chains: [], overlay: {}, refPolicy: { default: 'wrap' },
    base: { presetId: 'base', patch: { 'allow-lan': true }, surgePatch: { general: { ipv6: false } }, loonPatch: { general: { 'test-timeout': 5 } } },
    routing: { mode: 'independent', config: { groups: [{ id: 'g', name: '代理', type: 'select', members: [{ kind: 'nodeset', ref: { type: 'local', id: 'nodes' } }] }], rules: [
      { id: 'before', matcher: { kind: 'rule', rule: { type: 'DOMAIN', value: 'before.test' } }, target: { kind: 'builtin', name: 'DIRECT' } },
      { id: 'remote', matcher: remoteRuleMatcher(url), target: { kind: 'group', groupId: 'g' } },
      { id: 'proc', matcher: { kind: 'rule', rule: { type: 'PROCESS', kind: 'name', mode: 'exact', value: 'Example' } }, target: { kind: 'group', groupId: 'g' } },
    ], final: { kind: 'builtin', name: 'DIRECT' } } } };
  const saved = await alice.post('/api/profiles', draft); expect(saved.status, saved.text).toBe(201);
  const profile = saved.json.item, token = h.store.createToken(profile.id).token;
  return { ...h, user, alice, bob, draft, profile, token };
}
describe('Loon 订阅与管理接口', () => {
  it('参数与 UA 识别、非法平台和未知目标明确拒绝', () => {
    expect(detectClient('Loon/3.5.3', {})).toEqual({ client: 'loon', platform: 'ios', by: 'ua' });
    expect(detectClient('Loon (macOS)', {})).toMatchObject({ client: 'loon', platform: 'macos' });
    expect(detectClient('Loon/3.5.3', { target: 'mihomo' }).client).toBe('mihomo');
    expect(() => detectClient('curl', { target: 'unknown' })).toThrow();
    expect(() => detectClient('Loon', { platform: 'unknown' })).toThrow();
  });
  it('主配置是完整 INI，节点按快照内联，基础设置隔离、规则顺序和平台差异有效', async () => {
    const h = await scenario(), res = await h.app.request('/sub/' + h.token, { headers: { 'user-agent': 'Loon/3.5.3' } });
    expect(res.status).toBe(200); expect(res.headers.get('content-type')).toContain('text/plain');
    const text = await res.text();
    expect(text).toContain('[General]\nip-mode = v4-only\nallow-wifi-access = false\ntest-timeout = 5');
    expect(text).toContain('节点 = trojan, example.test, 443, "example", transport=tcp');
    expect(text).toContain('[Rule]\nDOMAIN,before.test,DIRECT\nDOMAIN,remote.test,代理\nIP-CIDR,192.0.2.0/24,代理,no-resolve\nFINAL,DIRECT');
    expect(text).not.toMatch(/mixed-port|loglevel|ipv6 =|PROCESS-NAME|Remote Rule|RULE-SET|__SF_/);
    const mac = await h.app.request('/sub/' + h.token + '?target=loon&platform=macos');
    expect(await mac.text()).toContain('PROCESS-NAME,Example,代理');
    expect(h.store.recentAccess(h.profile.id).map(x => x.client)).toContain('loon');
    expect((await h.app.request('/sub/' + h.token + '?target=loon&platform=linux')).status).toBe(400);
    h.store.deleteToken(h.token); expect((await h.app.request('/sub/' + h.token + '?target=loon')).status).toBe(404);
  });
  it('两种预览、规则转换与 Loon 专用改写有效，用户隔离和基础校验有效', async () => {
    const h = await scenario();
    for (const path of ['/api/profiles/preview', '/api/profiles/' + h.profile.id + '/preview']) {
      const res = await h.alice.post(path, { profile: h.profile, client: 'loon', platform: 'ios' });
      expect(res.json.ok, res.text).toBe(true); expect(res.json.format).toBe('ini');
      expect(res.json.yaml).not.toMatch(/__SF_|RULE-SET/);
    }
    expect(h.store.getLastGood(h.profile.id, 'loon:ios')).toBeUndefined();
    expect((await h.bob.post('/api/profiles/' + h.profile.id + '/preview', { client: 'loon' })).status).toBe(404);
    expect((await h.bob.post('/api/profiles/preview', { profile: h.profile, client: 'loon' })).status).toBe(400);
    const inputs = [{ source: { id: 's', kind: 'local', format: 'auto' }, content: 'DST-PORT,443\nGEOSITE,cn' }];
    const overrides = [{ match: 'GEOSITE,cn', override: { when: { client: 'loon' }, action: { replace: [{ type: 'DOMAIN-SUFFIX', value: 'cn' }] } } }];
    const rules = await h.alice.post('/api/rules/convert', { inputs, overrides, client: 'loon' });
    expect(rules.status, rules.text).toBe(200);
    expect(rules.json.lines).toEqual(['DEST-PORT,443', 'DOMAIN-SUFFIX,cn']);
    const legacy = await h.alice.post('/api/rulesets/preview', { ruleset: { sources: inputs.map(i => ({ ...i.source, content: i.content })), overrides }, client: 'loon' });
    expect(legacy.json.lines).toEqual(rules.json.lines);
    expect((await h.alice.post('/api/presets', { name: '非法', mihomo: {}, loon: { proxies: [] } })).status).toBe(400);
    expect((await h.alice.post('/api/profiles', { ...h.draft, base: { loonPatch: [] } })).status).toBe(400);
  });
  it('不支持的协议使用同目标 last-good，不能借用其他客户端结果', async () => {
    const h = await scenario(), verify = vi.fn(async () => ({ ok: true, output: '' }));
    const renderer = new RenderService(h.store, h.snapshots, { publicUrl: 'https://sub.test', verify });
    const original = await renderer.render(h.profile.id, { client: 'loon', platform: 'ios' });
    expect(original.ok).toBe(true); expect(verify).not.toHaveBeenCalled();
    h.store.put('local', { id: 'nodes', name: '节点', proxies: [{ name: '节点', type: 'tuic', server: 'example.test', port: 443, uuid: '0233d11c-15a4-47d3-ade3-48ffca0ce119', password: 'example' }] }, h.user.id);
    const fallback = await renderer.render(h.profile.id, { client: 'loon', platform: 'ios' });
    expect(fallback).toMatchObject({ ok: true, source: 'last-good' });
    if (fallback.ok && original.ok) expect(fallback.render.yaml).toBe(original.render.yaml);
    expect((await renderer.render(h.profile.id, { client: 'loon', platform: 'macos' })).ok).toBe(false);
    const failed = await h.alice.post('/api/profiles/preview', { profile: h.profile, client: 'loon', platform: 'ios' });
    expect(failed.json.ok).toBe(false); expect(failed.json.failure).toContain('tuic');
  });
});
