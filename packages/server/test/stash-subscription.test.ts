import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { remoteRuleMatcher } from '@sub-forge/core';
import { detectClient } from '../src/client.ts';
import { RenderService } from '../src/render.ts';
import { addUser, client, setupApp } from './helpers.ts';

const envs: ReturnType<typeof setupApp>[] = [];
afterEach(async () => { for (const env of envs.splice(0)) { await env.snapshots.settled(); env.store.close(); } });
const rulesUrl = 'https://rules.example.test/paypal.list';
const rulesBody = 'DOMAIN,paypal.test\nUSER-AGENT,PayPal*\nIP-CIDR,192.0.2.0/24,no-resolve';
async function scenario() {
  const env = setupApp({ fetcher: async url => {
    if (url !== rulesUrl) throw new Error(`未声明的测试地址 ${url}`);
    return { status: 200, body: rulesBody };
  } });
  envs.push(env);
  const user = await addUser(env.store, 'alice', 'admin'); await addUser(env.store, 'bob');
  const alice = client(env.app), bob = client(env.app); await alice.login('alice'); await bob.login('bob');
  env.store.put('preset', { id: 'preset', name: '双客户端', version: 1, mihomo: { 'mixed-port': 7890, dns: { enable: true } }, stash: { mode: 'rule', dns: { nameserver: ['https://dns.example.test/dns-query'] } } }, user.id);
  env.store.put('local', { id: 'nodes', name: '节点', proxies: [{ name: '测试节点', type: 'hysteria2', server: 'example.test', port: 443, password: 'example-password' }] }, user.id);
  const draft = { name: '双客户端订阅', nodeSets: [{ ref: { type: 'local', id: 'nodes' }, output: 'provider' }], chains: [], overlay: {}, refPolicy: { default: 'wrap' }, base: { presetId: 'preset', patch: { 'allow-lan': true }, stashPatch: { 'log-level': 'warning' } },
    routing: { mode: 'independent', config: { groups: [{ id: 'g', name: '代理', type: 'select', members: [{ kind: 'nodeset', ref: { type: 'local', id: 'nodes' } }] }], rules: [
      { id: 'remote', matcher: remoteRuleMatcher(rulesUrl), target: { kind: 'group', groupId: 'g' } },
      { id: 'proc', matcher: { kind: 'rule', rule: { type: 'PROCESS', kind: 'name', mode: 'exact', value: 'Example' } }, target: { kind: 'group', groupId: 'g' } },
    ], final: { kind: 'builtin', name: 'DIRECT' } } } };
  const saved = await alice.post('/api/profiles', draft);
  expect(saved.status, saved.text).toBe(201);
  const token = env.store.createToken(saved.json.item.id).token;
  return { ...env, user, alice, bob, profile: saved.json.item, token, draft };
}

describe('Stash 主订阅与资源隔离', () => {
  it('UA 与参数正确识别，macOS 优先于 iOS 默认值', () => {
    expect(detectClient('Stash/3.6.0', {})).toEqual({ client: 'stash', platform: 'ios', by: 'ua' });
    expect(detectClient('Stash/4.3.0 (macOS)', {})).toEqual({ client: 'stash', platform: 'macos', by: 'ua' });
    expect(detectClient('Stash/3.6.0', { target: 'mihomo' }).client).toBe('mihomo');
    expect(detectClient('curl', { target: 'stash', platform: 'macos' })).toEqual({ client: 'stash', platform: 'macos', by: 'param' });
  });

  it('完整订阅有独立基础设置、节点字段、平台规则及可下载的配套规则', async () => {
    const h = await scenario();
    const res = await h.app.request(`/sub/${h.token}`, { headers: { 'user-agent': 'Stash/3.6.0' } });
    expect(res.status).toBe(200);
    const yaml = parse(await res.text());
    expect(yaml['mixed-port']).toBeUndefined(); expect(yaml['allow-lan']).toBeUndefined();
    expect(yaml['log-level']).toBe('warning');
    expect(yaml.dns).toEqual({ nameserver: ['https://dns.example.test/dns-query'] });
    expect(yaml.proxies[0]).toMatchObject({ name: '测试节点', auth: 'example-password' });
    expect(yaml.proxies[0].password).toBeUndefined();
    expect(yaml['proxy-providers']).toBeUndefined();
    expect(yaml.rules).not.toContain('PROCESS-NAME,Example,代理');
    const provider = Object.values(yaml['rule-providers'])[0] as { url: string };
    expect(provider.url).toContain('target=stash');
    const file = await h.app.request(provider.url);
    expect(file.status).toBe(200); expect(await file.text()).toContain('\nUSER-AGENT,PayPal*\n');
    expect((await h.app.request(provider.url.replace('target=stash', 'target=mihomo'))).status).toBe(404);
    const mac = parse(await (await h.app.request(`/sub/${h.token}?target=stash&platform=macos`)).text());
    expect(mac.rules).toContain('PROCESS-NAME,Example,代理');
    const mihomo = parse(await (await h.app.request(`/sub/${h.token}?target=mihomo&platform=ios`)).text());
    expect(mihomo['mixed-port']).toBe(7890); expect(mihomo.proxies).toEqual([]);
    const mihomoUrl = (Object.values(mihomo['rule-providers'])[0] as { url: string }).url;
    expect(await (await h.app.request(mihomoUrl)).text()).toContain('# [mihomo 不支持 USER-AGENT]');
    expect(h.store.recentAccess(h.profile.id).map(x => x.client)).toContain('stash');
    h.store.deleteToken(h.token);
    expect((await h.app.request(provider.url)).status).toBe(404);
  });

  it('历史规则版本保留自身内容，不能跨客户端或跨平台借用', async () => {
    const h = await scenario();
    const config = parse(await (await h.app.request(`/sub/${h.token}?target=stash&platform=ios`)).text());
    const url = (Object.values(config['rule-providers'])[0] as { url: string }).url;
    const doc = h.store.get('profile', h.profile.id)!;
    h.store.put('profile', { ...doc, base: { ...doc.base, stashPatch: { mode: 'direct' } } }, h.user.id);
    expect((await h.app.request(`/sub/${h.token}?target=stash&platform=ios`)).status).toBe(200);
    expect(await (await h.app.request(url)).text()).toContain('USER-AGENT,PayPal*');
    expect((await h.app.request(url.replace('platform=ios', 'platform=macos'))).status).toBe(404);
  });

  it('草稿预览和独立文件导出可用，不写缓存，导出没有占位 token', async () => {
    const h = await scenario();
    for (const path of ['/api/profiles/preview', `/api/profiles/${h.profile.id}/preview`]) {
      const preview = await h.alice.post(path, { profile: h.profile, client: 'stash', platform: 'ios' });
      expect(preview.status).toBe(200); expect(preview.json.ok, preview.text).toBe(true);
      expect(preview.json.exportYaml).not.toMatch(/\{token\}|__SF_TOKEN__/);
      const yaml = parse(preview.json.exportYaml);
      expect(yaml['rule-providers']).toBeUndefined();
      expect(yaml.rules).toEqual(['DOMAIN,paypal.test,代理', 'USER-AGENT,PayPal*,代理', 'IP-CIDR,192.0.2.0/24,代理,no-resolve', 'MATCH,DIRECT']);
    }
    expect(h.store.getLastGood(h.profile.id, 'stash:ios')).toBeUndefined();
    expect((await h.bob.post(`/api/profiles/${h.profile.id}/preview`, { client: 'stash' })).status).toBe(404);
    expect((await h.bob.post('/api/profiles/preview', { profile: h.profile, client: 'stash' })).status).toBe(400);
  });

  it('规则预览、下载和 Stash 专用改写可用，非法平台和基础设置被拒绝', async () => {
    const h = await scenario();
    const inputs = [{ source: { id: 'local', kind: 'local', format: 'auto' }, content: 'USER-AGENT,PayPal*' }];
    const overrides = [{ override: { when: { client: 'stash' }, action: { append: [{ type: 'RAW', client: 'stash', text: 'URL-REGEX,^https://example.test/' }] } } }];
    const converted = await h.alice.post('/api/rules/convert', { inputs, overrides, client: 'stash', platform: 'ios' });
    expect(converted.status, converted.text).toBe(200);
    expect(converted.json.lines).toEqual(['USER-AGENT,PayPal*', 'URL-REGEX,^https://example.test/']);
    const legacy = await h.alice.post('/api/rulesets/preview', { ruleset: { sources: inputs.map(i => ({ ...i.source, content: i.content })) }, client: 'stash', platform: 'ios' });
    expect(legacy.json.lines).toEqual(['USER-AGENT,PayPal*']);
    const file = await h.alice.get(`/api/rules/convert?url=${encodeURIComponent(rulesUrl)}&target=stash&platform=ios`);
    expect(file.status).toBe(200); expect(file.text).toContain('USER-AGENT,PayPal*');
    expect((await h.alice.post('/api/rules/convert', { inputs, client: 'stash', platform: 'linux' })).status).toBe(400);
    expect((await h.alice.post('/api/profiles/preview', { profile: h.profile, client: 'stash', platform: 'android' })).status).toBe(400);
    expect((await h.app.request(`/sub/${h.token}?target=stash&platform=linux`)).status).toBe(400);
    expect((await h.alice.post('/api/presets', { name: '非法设置', mihomo: {}, stash: [] })).status).toBe(400);
    expect((await h.alice.post('/api/profiles', { ...h.draft, base: { stashPatch: [] } })).status).toBe(400);
  });

  it('失败只回退同客户端的成功结果，不调用 Mihomo 校验器验证 Stash', async () => {
    const h = await scenario();
    const verify = vi.fn(async () => ({ ok: true, output: '' }));
    const renderer = new RenderService(h.store, h.snapshots, { publicUrl: 'https://sub.test', verify });
    expect((await renderer.render(h.profile.id, { client: 'stash', platform: 'ios' })).ok).toBe(true);
    expect(verify).not.toHaveBeenCalled();
    expect((await renderer.render(h.profile.id, { client: 'mihomo' })).ok).toBe(true);
    expect(verify).toHaveBeenCalledTimes(1);
    h.store.put('local', { id: 'nodes', name: '不支持的协议', proxies: [{ name: '测试节点', type: 'sudoku', server: 'example.test', port: 443 }] }, h.user.id);
    const fallback = await renderer.render(h.profile.id, { client: 'stash', platform: 'ios' });
    expect(fallback).toMatchObject({ ok: true, source: 'last-good' });
    if (!fallback.ok) throw new Error(fallback.message);
    expect(parse(fallback.render.yaml).proxies[0].auth).toBe('example-password');
    expect((await renderer.render(h.profile.id, { client: 'stash', platform: 'macos' })).ok).toBe(false);
  });
});
