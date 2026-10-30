import { afterEach, describe, expect, it, vi } from 'vitest';
import { remoteRuleMatcher } from '@sub-forge/core';
import { RenderService } from '../src/render.ts';
import { addUser, client, setupApp } from './helpers.ts';

const envs: ReturnType<typeof setupApp>[] = [];
afterEach(async () => { for (const env of envs.splice(0)) { await env.snapshots.settled(); env.store.close(); } });
async function scenario() {
  const url = 'https://rules.example.test/surge.list';
  const env = setupApp({ fetcher: async input => {
    if (input !== url) throw new Error('未声明的测试地址');
    return { status: 200, body: 'DOMAIN,example.test,extended-matching\nIP-CIDR,192.0.2.0/24,no-resolve\nUSER-AGENT,Example*' };
  } });
  envs.push(env);
  const user = await addUser(env.store, 'alice', 'admin'); await addUser(env.store, 'bob');
  const alice = client(env.app), bob = client(env.app); await alice.login('alice'); await bob.login('bob');
  env.store.put('preset', { id: 'base', name: '独立基础配置', version: 1, mihomo: { 'mixed-port': 7890 }, surge: { general: { ipv6: false, loglevel: 'notify' } } }, user.id);
  env.store.put('local', { id: 'nodes', name: '节点', proxies: [{ name: '节点', type: 'trojan', server: 'example.test', port: 443, password: 'example' }] }, user.id);
  const draft = { name: 'Surge', nodeSets: [{ ref: { type: 'local', id: 'nodes' }, output: 'provider' }], chains: [], overlay: {}, refPolicy: { default: 'wrap' },
    base: { presetId: 'base', patch: { 'allow-lan': true }, surgePatch: { general: { 'test-timeout': 5 } } },
    routing: { mode: 'independent', config: { groups: [{ id: 'g', name: '代理', type: 'select', members: [{ kind: 'nodeset', ref: { type: 'local', id: 'nodes' } }] }],
      rules: [{ id: 'rs', matcher: remoteRuleMatcher(url), target: { kind: 'group', groupId: 'g' } }, { id: 'proc', matcher: { kind: 'rule', rule: { type: 'PROCESS', kind: 'name', mode: 'exact', value: 'Example' } }, target: { kind: 'group', groupId: 'g' } }], final: { kind: 'builtin', name: 'DIRECT' } } } };
  const saved = await alice.post('/api/profiles', draft); expect(saved.status, saved.text).toBe(201);
  const profile = saved.json.item, token = env.store.createToken(user.id).token;
  return { ...env, user, alice, bob, profile, draft, token };
}
const resourceUrl = (text: string) => {
  const match = /^RULE-SET,([^,]+),/m.exec(text);
  if (!match) throw new Error('缺少规则资源 URL');
  return match[1]!;
};
describe('Surge 主订阅和 API', () => {
  it('完整 INI 使用独立基础配置、正确 MIME、客户端与平台规则资源', async () => {
    const h = await scenario();
    const res = await h.app.request('/sub/' + h.token + '/' + h.profile.id, { headers: { 'user-agent': 'Surge iOS/3412' } });
    expect(res.status).toBe(200); expect(res.headers.get('content-type')).toContain('text/plain');
    const text = await res.text();
    expect(text).toContain('#!MANAGED-CONFIG https://sub.test/sub/' + h.token + '/' + h.profile.id + '?target=surge&platform=ios interval=86400 strict=false');
    expect(text).toContain('[General]\nipv6 = false\nloglevel = notify\ntest-timeout = 5');
    expect(text).not.toMatch(/mixed-port|allow-lan|PROCESS-NAME/);
    expect(text).toContain('节点 = trojan, example.test, 443, password="example"');
    expect(text).toContain('FINAL,DIRECT');
    const url = resourceUrl(text), file = await h.app.request(url);
    expect(url).toContain('/r/' + h.token + '/'); expect(file.status).toBe(200);
    expect(await file.text()).toContain('DOMAIN,example.test,extended-matching');
    expect(await (await h.app.request(url + '?target=mihomo')).text()).toContain('DOMAIN,example.test,extended-matching');
    expect(await (await h.app.request(url + '?platform=macos')).text()).not.toContain('PROCESS-NAME');
    const mac = await h.app.request('/sub/' + h.token + '/' + h.profile.id + '?target=surge&platform=macos');
    expect(await mac.text()).toContain('PROCESS-NAME,Example,代理');
    h.store.deleteToken(h.token);
    expect((await h.app.request(url)).status).toBe(404);
  });
  it('预览和独立导出不留占位 token，预览不写 last-good，用户隔离有效', async () => {
    const h = await scenario();
    for (const path of ['/api/profiles/preview', '/api/profiles/' + h.profile.id + '/preview']) {
      const res = await h.alice.post(path, { profile: h.profile, client: 'surge', platform: 'ios' });
      expect(res.json.ok, res.text).toBe(true); expect(res.json.format).toBe('ini');
      expect(res.json.exportYaml).not.toMatch(/__SF_|RULE-SET/);
      expect(res.json.exportYaml).toContain('DOMAIN,example.test,代理,extended-matching\nIP-CIDR,192.0.2.0/24,代理,no-resolve\nUSER-AGENT,Example*,代理');
    }
    expect(h.store.getLastGood(h.profile.id, 'surge:ios')).toBeUndefined();
    expect((await h.bob.post('/api/profiles/' + h.profile.id + '/preview', { client: 'surge' })).status).toBe(404);
    expect((await h.bob.post('/api/profiles/preview', { profile: h.profile, client: 'surge' })).status).toBe(400);
  });
  it('拒绝未知客户端、非法平台、越界基础段和换行，不影响 YAML 配置', async () => {
    const h = await scenario();
    expect((await h.app.request('/sub/' + h.token + '/' + h.profile.id + '?target=unknown')).status).toBe(400);
    expect((await h.app.request('/sub/' + h.token + '/' + h.profile.id + '?target=surge&platform=linux')).status).toBe(400);
    expect((await h.alice.post('/api/profiles/preview', { profile: h.profile, client: 'surge', platform: 'android' })).status).toBe(400);
    expect((await h.alice.post('/api/presets', { name: '非法', mihomo: {}, surge: { proxies: [] } })).status).toBe(400);
    expect((await h.alice.post('/api/profiles', { ...h.draft, base: { surgePatch: { general: { loglevel: 'notify\n[Rule]' } } } })).status).toBe(400);
    const mihomo = await h.app.request('/sub/' + h.token + '/' + h.profile.id + '?target=mihomo');
    expect(mihomo.status).toBe(200); expect(await mihomo.text()).toContain('mixed-port: 7890');
  });
  it('失败只使用 Surge 同平台 last-good，不调用 Mihomo 校验器验证 INI', async () => {
    const h = await scenario(), verify = vi.fn(async () => ({ ok: true, output: '' }));
    const renderer = new RenderService(h.store, h.snapshots, { publicUrl: 'https://sub.test', verify });
    const original = await renderer.render(h.profile.id, { client: 'surge', platform: 'ios' });
    expect(original.ok).toBe(true); expect(verify).not.toHaveBeenCalled();
    h.store.put('local', { id: 'nodes', name: '节点', proxies: [{ name: '节点', type: 'vless', server: 'example.test', port: 443, uuid: 'example' }] }, h.user.id);
    const fallback = await renderer.render(h.profile.id, { client: 'surge', platform: 'ios' });
    expect(fallback).toMatchObject({ ok: true, source: 'last-good' });
    if (original.ok && fallback.ok) expect(fallback.render.yaml).toBe(original.render.yaml);
    expect((await renderer.render(h.profile.id, { client: 'surge', platform: 'macos' })).ok).toBe(false);
  });
});
