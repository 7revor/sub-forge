import { afterEach, expect, it, vi } from 'vitest';
import { remoteRuleMatcher, stableHash, stableStringify, type Matcher } from '@sub-forge/core';
import { setupApp } from './helpers.ts';
import type { UpstreamFetcher } from '../src/net/upstream.ts';

const envs: ReturnType<typeof setupApp>[] = [];
afterEach(async () => { for (const h of envs.splice(0)) { await h.snapshots.settled(); h.store.close(); } });
function setup() {
  const raw = '# 保留注释\n\nDOMAIN,file.example.test\n<script>不会执行</script>\n';
  const fetcher = vi.fn<UpstreamFetcher>(async () => ({ status: 200, body: raw }));
  const h = setupApp({ fetcher }); envs.push(h);
  const owner = h.store.createUser({ username: 'owner', passwordHash: 'fixture', role: 'admin' });
  const reader = h.store.createUser({ username: 'reader', passwordHash: 'fixture', role: 'user' });
  const token = h.store.userToken(owner.id)!.token, readerToken = h.store.userToken(reader.id)!.token;
  const matcher = remoteRuleMatcher('https://rules.example.test/File.list');
  const rules = [{ id: 'remote', matcher, target: { kind: 'builtin' as const, name: 'DIRECT' as const } },
    { id: 'static', matcher: { kind: 'local' as const, content: 'DOMAIN,static.test' }, target: { kind: 'builtin' as const, name: 'DIRECT' as const } }];
  const config = { groups: [], rules, final: { kind: 'builtin' as const, name: 'DIRECT' as const } };
  h.store.putTemplateVersion({ id: 'template', name: '公共模板', version: 1, ...config });
  h.store.put('profile', { id: 'profile', name: '私有订阅', nodeSets: [], chains: [], overlay: {}, refPolicy: { default: 'wrap' }, routing: { mode: 'independent', config } }, owner.id);
  h.store.put('profile', { id: 'bound', name: '绑定订阅', nodeSets: [], chains: [], overlay: {}, refPolicy: { default: 'wrap' }, routing: { mode: 'bound', templateId: 'template', groupAdditions: {}, extraGroups: [] } }, owner.id);
  const link = (kind = 'templates', id = 'template', credential = token, rule = 'remote', value: Matcher = matcher) =>
    `/api/files/${credential}/${kind}/${id}/rules/${rule}?revision=${stableHash(stableStringify(value))}`;
  return { ...h, raw, fetcher, owner, reader, token, readerToken, matcher, config, link };
}

it('不依赖会话，公共模板接受其他用户 token；文件保留原文且直接展示，多个入口共用原文缓存', async () => {
  const h = setup();
  for (const url of [h.link(), h.link('templates', 'template', h.readerToken), h.link('profiles', 'profile'), h.link('profiles', 'bound')]) {
    const response = await h.app.request(url);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.text()).toBe(h.raw);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(response.headers.get('content-disposition')).toMatch(/^inline;/);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  }
  expect(h.fetcher).toHaveBeenCalledTimes(1);
  expect(h.store.db.prepare('SELECT COUNT(*) AS n FROM shared_rule_resources').get()).toEqual({ n: 0 });
  const head = await h.app.request(h.link(), { method: 'HEAD' });
  expect(head.status).toBe(200); expect(await head.text()).toBe('');
  expect(head.headers.get('content-disposition')).toMatch(/^inline;/);
});

it('他人订阅、无效 token、静态规则和未保存规则均不能读取，拒绝任意 URL 参数', async () => {
  const h = setup();
  for (const url of [h.link('profiles', 'profile', h.readerToken), h.link('templates', 'template', 'invalid'), h.link('templates', 'missing'), h.link('templates', 'template', h.token, 'static'), h.link('templates', 'template', h.token, 'unsaved')]) {
    expect((await h.app.request(url)).status).toBe(404);
  }
  expect((await h.app.request(h.link().replace(/revision=.*/, 'revision=unsaved') + '&url=https://untrusted.test/')).status).toBe(409);
  expect(h.fetcher).not.toHaveBeenCalled();
  const response = await h.app.request(h.link() + '&url=https://untrusted.test/');
  expect(await response.text()).toBe(h.raw);
  expect(h.fetcher.mock.calls[0]?.[0]).toBe('https://rules.example.test/File.list');
});

it('公共增强引用返回启用来源原文，不执行增强改写，删除后原链接失效', async () => {
  const h = setup();
  const matcher: Matcher = { kind: 'ruleset', id: 'enhance' };
  h.store.put('ruleset', { id: 'enhance', name: '增强名称', sources: [{ id: 'one', kind: 'local', format: 'auto', content: '# 原文\nDOMAIN,one.test' }, { id: 'off', kind: 'local', format: 'auto', content: 'DOMAIN,hidden.test', enabled: false }] }, h.owner.id);
  h.store.putTemplateVersion({ id: 'template', name: '公共模板', version: 1, ...h.config, rules: [{ ...h.config.rules[0]!, matcher }] });
  const url = h.link('templates', 'template', h.readerToken, 'remote', matcher);
  expect(await (await h.app.request(url)).text()).toBe('# 原文\nDOMAIN,one.test');
  h.store.delete('ruleset', 'enhance');
  expect((await h.app.request(url)).status).toBe(404);
});

it.each(['reset', 'disable', 'delete-profile', 'replace-profile', 'remove-template-rule', 'delete-ruleset'])('在途读取遇到 %s 不返回旧正文', async action => {
  const h = setup();
  let started!: () => void, finish!: () => void;
  const began = new Promise<void>(resolve => { started = resolve; });
  const pending = new Promise<void>(resolve => { finish = resolve; });
  h.fetcher.mockImplementation(async () => { started(); await pending; return { status: 200, body: h.raw }; });
  let url = h.link('profiles', 'profile');
  if (action === 'remove-template-rule') url = h.link();
  if (action === 'delete-ruleset') {
    const matcher: Matcher = { kind: 'ruleset', id: 'enhance' };
    h.store.put('ruleset', { id: 'enhance', name: '增强', sources: [{ id: 'one', kind: 'remote', url: 'https://rules.example.test/File.list', format: 'auto' }] }, h.owner.id);
    h.store.putTemplateVersion({ id: 'template', name: '模板', version: 1, ...h.config, rules: [{ ...h.config.rules[0]!, matcher }] });
    url = h.link('templates', 'template', h.token, 'remote', matcher);
  }
  const request = h.app.request(url);
  await began;
  if (action === 'reset') h.store.resetToken(h.token);
  if (action === 'disable') h.store.updateUser(h.owner.id, { disabled: true });
  if (action === 'delete-profile' || action === 'replace-profile') {
    const doc = h.store.get('profile', 'profile')!;
    h.store.delete('profile', 'profile');
    if (action === 'replace-profile') h.store.put('profile', doc, h.owner.id);
  }
  if (action === 'remove-template-rule') h.store.putTemplateVersion({ id: 'template', name: '模板', version: 1, ...h.config, rules: [] });
  if (action === 'delete-ruleset') h.store.delete('ruleset', 'enhance');
  finish();
  const response = await request;
  expect(response.status).toBe(action === 'replace-profile' ? 409 : 404);
  expect(await response.text()).not.toContain('file.example.test');
});

it('二进制规则拒绝文本预览', async () => {
  const h = setup(), matcher: Matcher = { kind: 'ruleset', id: 'binary' };
  h.store.put('ruleset', { id: 'binary', name: '二进制', sources: [{ id: 'mrs', kind: 'remote', format: 'mrs', url: 'https://rules.example.test/r.mrs' }] }, h.owner.id);
  h.store.putTemplateVersion({ id: 'template', name: '模板', version: 1, ...h.config, rules: [{ ...h.config.rules[0]!, matcher }] });
  expect((await h.app.request(h.link('templates', 'template', h.token, 'remote', matcher))).status).toBe(415);
  expect(h.fetcher).not.toHaveBeenCalled();
});
