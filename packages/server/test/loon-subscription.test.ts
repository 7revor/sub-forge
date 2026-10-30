import { stringify as testYaml } from 'yaml';
import { stringifyIniBase as testIni } from '@sub-forge/core';
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
  h.store.put('preset', { id: 'base', name: '隔离预设', version: 1, config: { kernels: {mihomo: testYaml({ 'mixed-port': 7890 }), surge: testIni({ general: { loglevel: 'notify' } }), loon: testIni({ general: { 'ip-mode': 'v4-only', 'allow-wifi-access': false } }) } } }, user.id);
  h.store.put('local', { id: 'nodes', name: '节点', proxies: [{ name: '节点', type: 'trojan', server: 'example.test', port: 443, password: 'example' }] }, user.id);
  const draft = { name: 'Loon', nodeSets: [{ ref: { type: 'local', id: 'nodes' }, output: 'provider' }], chains: [], overlay: {}, refPolicy: { default: 'wrap' },
    base: { presetId: 'base', kernels: {mihomo: testYaml({ 'allow-lan': true }), surge: testIni({ general: { ipv6: false } }), loon: testIni({ general: { 'test-timeout': 5 } }) } },
    routing: { mode: 'independent', config: { groups: [{ id: 'g', name: '代理', type: 'select', members: [{ kind: 'nodeset', ref: { type: 'local', id: 'nodes' } }] }], rules: [
      { id: 'before', matcher: { kind: 'rule', rule: { type: 'DOMAIN', value: 'before.test' } }, target: { kind: 'builtin', name: 'DIRECT' } },
      { id: 'remote', matcher: remoteRuleMatcher(url), target: { kind: 'group', groupId: 'g' } },
      { id: 'proc', matcher: { kind: 'rule', rule: { type: 'PROCESS', kind: 'name', mode: 'exact', value: 'Example' } }, target: { kind: 'group', groupId: 'g' } },
    ], final: { kind: 'builtin', name: 'DIRECT' } } } };
  const saved = await alice.post('/api/profiles', draft); expect(saved.status, saved.text).toBe(201);
  const profile = saved.json.item, token = h.store.createToken(user.id).token;
  return { ...h, user, alice, bob, draft, profile, token };
}
describe('Loon 订阅与管理接口', () => {
  it('参数与 UA 识别、非法平台和未知目标明确拒绝', () => {
    expect(detectClient('Loon/3.5.3', {})).toMatchObject({ client: 'loon', platform: 'ios', by: 'ua' });
    expect(detectClient('Loon (macOS)', {})).toMatchObject({ client: 'loon', platform: 'macos' });
    expect(detectClient('Loon/3.5.3', { target: 'mihomo' }).client).toBe('mihomo');
    expect(() => detectClient('curl', { target: 'unknown' })).toThrow();
    expect(() => detectClient('Loon', { platform: 'unknown' })).toThrow();
  });
  it('主配置只引用托管规则，手写规则与规则集顺序、平台隔离和令牌撤销有效', async () => {
    const h = await scenario(), res = await h.app.request(`/subs/profile?token=${h.token}&id=${h.profile.id}`, { headers: { 'user-agent': 'Loon/3.5.3' } });
    expect(res.status).toBe(200); expect(res.headers.get('content-type')).toContain('text/plain');
    const text = await res.text();
    expect(text).toContain('[General]\nip-mode = v4-only\nallow-wifi-access = false\ntest-timeout = 5');
    expect(text).toContain('节点 = trojan, example.test, 443, "example", transport=tcp');
    expect(text).toContain('[Rule]\nFINAL,DIRECT\n\n[Remote Rule]');
    const links = text.split('[Remote Rule]\n')[1]!.trim().split('\n').map(line => line.split(',policy=')[0]!);
    expect(links).toHaveLength(2);
    const bodies = [];
    for (const link of links) {
      const url = new URL(link);
      expect(url.pathname).toBe('/subs/ruleset');
      expect(url.searchParams.get('target')).toBe('loon');
      const resource = await h.app.request(link); expect(resource.status).toBe(200); bodies.push(await resource.text());
      const wrongClient = new URL(link); wrongClient.searchParams.set('target', 'surge');
      expect((await h.app.request(wrongClient.href)).status).toBe(404);
      const otherUser = new URL(link); otherUser.searchParams.set('token', h.store.createToken(h.store.getUserAuth('bob')!.id).token);
      expect((await h.app.request(otherUser.href)).status).toBe(404);
    }
    expect(bodies).toEqual(['DOMAIN,before.test\n', 'DOMAIN,remote.test\nIP-CIDR,192.0.2.0/24,no-resolve\n']);
    expect(text).not.toMatch(/mixed-port|loglevel|ipv6 =|DOMAIN,|IP-CIDR,|PROCESS-NAME|RULE-SET|__SF_/);
    const mac = await h.app.request(`/subs/profile?token=${h.token}&id=${h.profile.id}&target=loon&platform=macos`);
    const macText = await mac.text();
    const macLinks = macText.split('[Remote Rule]\n')[1]!.trim().split('\n').map(line => line.split(',policy=')[0]!);
    expect(macLinks).toHaveLength(3);
    expect(await (await h.app.request(macLinks[2]!)).text()).toBe('PROCESS-NAME,Example\n');
    expect(h.store.recentAccess(h.profile.id).map(x => x.client)).toContain('loon');
    expect((await h.app.request(`/subs/profile?token=${h.token}&id=${h.profile.id}&target=loon&platform=linux`)).status).toBe(400);
    h.store.deleteToken(h.token);
    for (const link of links) expect((await h.app.request(link)).status).toBe(404); expect((await h.app.request(`/subs/profile?token=${h.token}&id=${h.profile.id}&target=loon`)).status).toBe(404);
  });
  it('两种预览、规则转换与 Loon 专用改写有效，用户隔离和基础校验有效', async () => {
    const h = await scenario();
    for (const path of ['/api/profiles/preview', '/api/profiles/' + h.profile.id + '/preview']) {
      const res = await h.alice.post(path, { profile: h.profile, client: 'loon', platform: 'ios' });
      expect(res.json.ok, res.text).toBe(true); expect(res.json.format).toBe('ini');
      expect(res.json.yaml).toContain('[Remote Rule]');
      expect(res.json.yaml).not.toMatch(/DOMAIN,|IP-CIDR,|RULE-SET/);
      expect(res.json.exportUnavailableReason).toContain('请保存配置后');
      expect(res.json.exportYaml).toBeUndefined();
    }
    expect(h.store.getLastGood(h.profile.id, 'loon:ios:loon-ios')).toBeUndefined();
    expect((await h.bob.post('/api/profiles/' + h.profile.id + '/preview', { client: 'loon' })).status).toBe(404);
    expect((await h.bob.post('/api/profiles/preview', { profile: h.profile, client: 'loon' })).status).toBe(400);
    const inputs = [{ source: { id: 's', kind: 'local', format: 'auto' }, content: 'DST-PORT,443\nGEOSITE,cn' }];
    const overrides = [{ match: 'GEOSITE,cn', override: { when: { client: 'loon' }, action: { replace: [{ type: 'DOMAIN-SUFFIX', value: 'cn' }] } } }];
    const rules = await h.alice.post('/api/rules/convert', { inputs, overrides, client: 'loon' });
    expect(rules.status, rules.text).toBe(200);
    expect(rules.json.lines).toEqual(['DEST-PORT,443', 'DOMAIN-SUFFIX,cn']);
    const legacy = await h.alice.post('/api/rulesets/preview', { ruleset: { sources: inputs.map(i => ({ ...i.source, content: i.content })), overrides }, client: 'loon' });
    expect(legacy.json.lines).toEqual(rules.json.lines);
    expect((await h.alice.post('/api/presets', { name: '非法', config: { kernels: {mihomo: testYaml({}), loon: {} } } })).status).toBe(400);
    expect((await h.alice.post('/api/profiles', { ...h.draft, base: { kernels: {loon: [] } } })).status).toBe(400);
  });
  it('手写规则只能由所属订阅读取，移除或改写后撤销历史正文', async () => {
    const h = await scenario();
    const main = await h.app.request(`/subs/profile?token=${h.token}&id=${h.profile.id}&target=loon&platform=ios`);
    const text = await main.text(), link = text.split('[Remote Rule]\n')[1]!.split(',policy=')[0]!;
    const url = new URL(link), key = url.searchParams.get('key')!;
    expect((await h.app.request(link)).status).toBe(200);
    expect(h.store.getSharedRule(key)).toBeUndefined();
    expect((await h.app.request(`/resources/ruleset?key=${key}&token=${h.token}`)).status).toBe(404);
    const profile = h.store.get('profile', h.profile.id)!;
    if (profile.routing?.mode !== 'independent') throw new Error('测试需要独立分流');
    profile.routing.config.rules[0]!.matcher = { kind: 'rule', rule: { type: 'DOMAIN', value: 'changed.test' } };
    h.store.put('profile', profile, h.user.id);
    expect((await h.app.request(link)).status).toBe(404);
    const current = await (await h.app.request(`/subs/profile?token=${h.token}&id=${h.profile.id}&target=loon&platform=ios`)).text();
    const changed = current.split('[Remote Rule]\n')[1]!.split(',policy=')[0]!;
    expect(await (await h.app.request(changed)).text()).toBe('DOMAIN,changed.test\n');
    profile.routing.config.rules.shift(); h.store.put('profile', profile, h.user.id);
    expect((await h.app.request(changed)).status).toBe(404);
  });
  it('跟随模板的手写规则托管后，模板移除引用会撤销旧版本', async () => {
    const h = await scenario();
    const profile = h.store.get('profile', h.profile.id)!;
    if (profile.routing?.mode !== 'independent') throw new Error('测试需要独立分流');
    const config = profile.routing.config;
    h.store.putTemplateVersion({ id: 'loon-template', name: 'Loon 模板', version: 1, ...config });
    h.store.put('profile', { ...profile, routing: { mode: 'bound', templateId: 'loon-template', groupAdditions: {} } }, h.user.id);
    const text = await (await h.app.request(`/subs/profile?token=${h.token}&id=${h.profile.id}&target=loon&platform=ios`)).text();
    const link = text.split('[Remote Rule]\n')[1]!.split(',policy=')[0]!;
    expect(await (await h.app.request(link)).text()).toBe('DOMAIN,before.test\n');
    h.store.putTemplateVersion({ id: 'loon-template', name: 'Loon 模板', version: 2, ...config, rules: config.rules.slice(1) });
    expect((await h.app.request(link)).status).toBe(404);
  });
  it('旧内联 last-good 不得在失败时重新下发', async () => {
    const h = await scenario();
    const original = await h.renderer.render(h.profile.id, { client: 'loon', platform: 'ios' });
    if (!original.ok) throw new Error('测试初始渲染失败');
    const legacy = { ...original.render, yaml: '[Rule]\nDOMAIN,before.test,DIRECT\nFINAL,DIRECT\n' };
    delete legacy.loonRuleDelivery;
    h.store.putLastGood(h.profile.id, 'loon:ios', legacy);
    h.store.put('local', { id: 'nodes', name: '节点', proxies: [{ name: '节点', type: 'tuic', server: 'example.test', port: 443 }] }, h.user.id);
    expect((await h.renderer.render(h.profile.id, { client: 'loon', platform: 'ios' })).ok).toBe(false);
    expect((await h.app.request(`/subs/profile?token=${h.token}&id=${h.profile.id}&target=loon&platform=ios`)).status).toBe(503);
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
