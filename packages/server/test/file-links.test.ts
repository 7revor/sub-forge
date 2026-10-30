import { afterEach, expect, it, vi } from 'vitest';
import { queryUrl, remoteRuleMatcher, stableHash, stableStringify, type Matcher } from '@sub-forge/core';
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
  const headers = { cookie: `sf_session=${h.store.createSession(owner.id, 3600000)}` };
  const matcher = remoteRuleMatcher('https://rules.example.test/File.list');
  const config = { groups: [], rules: [{ id: 'remote', matcher, target: { kind: 'builtin' as const, name: 'DIRECT' as const } }], final: { kind: 'builtin' as const, name: 'DIRECT' as const } };
  h.store.putTemplateVersion({ id: 'template', name: '模板', version: 1, ...config });
  h.store.put('profile', { id: 'profile', name: '私有订阅', nodeSets: [], chains: [], overlay: {}, refPolicy: { default: 'wrap' }, routing: { mode: 'independent', config } }, owner.id);
  h.store.put('profile', { id: 'bound', name: '绑定订阅', nodeSets: [], chains: [], overlay: {}, refPolicy: { default: 'wrap' }, routing: { mode: 'bound', templateId: 'template', groupAdditions: {}, extraGroups: [] } }, owner.id);
  const link = (profile = 'profile', credential = token, rule = 'remote', value: Matcher = matcher) => queryUrl('/subs/ruleset', { profile, token: credential, rule, view: 'source', revision: stableHash(stableStringify(value)) });
  const templateLink = queryUrl('/api/templates/rule-file', { id: 'template', rule: 'remote', revision: stableHash(stableStringify(matcher)) });
  return { ...h, raw, fetcher, owner, reader, token, readerToken, matcher, config, link, headers, templateLink };
}

it('订阅专属原文用所有者 token，绑定模板后也只通过订阅暴露；模板原文仅接受登录会话', async () => {
  const h = setup();
  for (const url of [h.link(), h.link('bound')]) {
    const response = await h.app.request(url);
    expect(response.status).toBe(200); expect(await response.text()).toBe(h.raw);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(response.headers.get('content-disposition')).toMatch(/^inline;/);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  }
  expect((await h.app.request(h.link('profile', h.readerToken), { headers: h.headers })).status).toBe(404);
  expect((await h.app.request(h.templateLink)).status).toBe(401);
  expect((await h.app.request(h.templateLink + '&token=' + h.token)).status).toBe(401);
  expect((await h.app.request(h.templateLink + '&token=' + h.token, { headers: h.headers })).status).toBe(400);
  expect(await (await h.app.request(h.templateLink, { headers: h.headers })).text()).toBe(h.raw);
  const head = await h.app.request(h.link(), { method: 'HEAD' });
  expect(head.status).toBe(200); expect(await head.text()).toBe('');
  expect(h.store.listSharedRules()).toHaveLength(0);
  expect(h.fetcher).toHaveBeenCalledTimes(3); // 两份私有订阅及内部模板各有绑定，权限范围不混用。
});

it('无效凭证不回退登录态，拒绝未保存引用、过期 revision、未知和重复查询参数', async () => {
  const h = setup();
  expect((await h.app.request(h.link('profile', 'invalid'), { headers: h.headers })).status).toBe(404);
  expect((await h.app.request(h.link('profile', h.token, 'unsaved'))).status).toBe(404);
  const stale = new URL(h.link(), 'https://sub.test'); stale.searchParams.set('revision', 'old');
  expect((await h.app.request(stale.href)).status).toBe(409);
  expect((await h.app.request(h.link() + '&url=https://untrusted.test/')).status).toBe(400);
  expect((await h.app.request(h.link() + '&token=' + h.readerToken)).status).toBe(400);
  expect(h.fetcher).not.toHaveBeenCalled();
});

it('公共增强原文独立共享，不执行增强改写；删除定义后原链接失效', async () => {
  const h = setup();
  h.store.put('ruleset', { id: 'enhance', name: '增强名称', sources: [{ id: 'one', kind: 'local', format: 'auto', content: '# 原文\nDOMAIN,one.test' }, { id: 'off', kind: 'local', format: 'auto', content: 'DOMAIN,hidden.test', enabled: false }] }, h.owner.id);
  const url = queryUrl('/resources/ruleset', { id: 'enhance', token: h.readerToken, view: 'source' });
  expect(await (await h.app.request(url)).text()).toBe('# 原文\nDOMAIN,one.test');
  expect(h.store.userAccessPage(h.reader.id, { page: 1, pageSize: 20, q: '' }).items).toMatchObject([{ kind: 'enhancement', resourceName: '增强名称', status: 200 }]);
  h.store.delete('ruleset', 'enhance'); expect((await h.app.request(url)).status).toBe(404);
});

it.each(['reset', 'disable', 'delete-profile', 'replace-profile', 'remove-template-rule', 'delete-ruleset'])('在途读取遇到 %s 不返回旧正文', async action => {
  const h = setup();
  let started!: () => void, finish!: () => void;
  const began = new Promise<void>(resolve => { started = resolve; }), pending = new Promise<void>(resolve => { finish = resolve; });
  h.fetcher.mockImplementation(async () => { started(); await pending; return { status: 200, body: h.raw }; });
  let url = action === 'remove-template-rule' ? h.link('bound') : h.link();
  if (action === 'delete-ruleset') {
    h.store.put('ruleset', { id: 'enhance', name: '增强', sources: [{ id: 'one', kind: 'remote', url: 'https://rules.example.test/File.list', format: 'auto' }] }, h.owner.id);
    url = queryUrl('/resources/ruleset', { id: 'enhance', view: 'source', token: h.token });
  }
  const request = h.app.request(url); await began;
  if (action === 'reset') h.store.resetToken(h.token);
  if (action === 'disable') h.store.updateUser(h.owner.id, { disabled: true });
  if (action === 'delete-profile' || action === 'replace-profile') {
    const doc = h.store.get('profile', 'profile')!; h.store.delete('profile', 'profile');
    if (action === 'replace-profile') h.store.put('profile', doc, h.owner.id);
  }
  if (action === 'remove-template-rule') h.store.putTemplateVersion({ id: 'template', name: '模板', version: 1, ...h.config, rules: [] });
  if (action === 'delete-ruleset') h.store.delete('ruleset', 'enhance');
  finish(); const response = await request;
  expect(response.status).toBe(404); expect(await response.text()).not.toContain('file.example.test');
});

it('无关配置更新不打断文件原文读取；二进制原文拒绝文本预览', async () => {
  const h = setup();
  h.fetcher.mockImplementation(async () => { h.store.put('local', { id: 'unrelated', name: '无关节点', proxies: [] }, h.owner.id); return { status: 200, body: h.raw }; });
  expect(await (await h.app.request(h.link())).text()).toBe(h.raw);
  h.store.put('ruleset', { id: 'binary', name: '二进制', sources: [{ id: 'mrs', kind: 'remote', format: 'mrs', url: 'https://rules.example.test/r.mrs' }] }, h.owner.id);
  expect((await h.app.request(queryUrl('/resources/ruleset', { id: 'binary', view: 'source', token: h.token }))).status).toBe(415);
});


it.each(['logout', 'disable'])('模板原文在途 %s 后拒绝正文，资源 token 不能替代失效会话', async action => {
  const h = setup();
  let started!: () => void, release!: () => void;
  const began = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  h.fetcher.mockImplementation(async () => { started(); await gate; return { status: 200, body: h.raw }; });
  const request = h.app.request(h.templateLink, { headers: h.headers }); await began;
  if (action === 'logout') h.store.deleteSession(h.headers.cookie.slice('sf_session='.length));
  else h.store.updateUser(h.owner.id, { disabled: true });
  release(); const response = await request;
  expect(response.status).toBe(401); expect(await response.text()).not.toContain('file.example.test');
  expect((await h.app.request(h.templateLink + '&token=' + h.token, { headers: h.headers })).status).toBe(401);
});

it('排队原文请求在删除后才开始拉取，也不能遗留私有绑定和快照', async () => {
  const h = setup();
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const began = new Promise<void>(resolve => { started = resolve; });
  let calls = 0;
  h.fetcher.mockImplementation(async () => { if (++calls === 4) started(); await gate; return { status: 200, body: h.raw }; });
  for (const id of ['active-1', 'active-2', 'active-3', 'active-4', 'queued']) h.store.put('profile', { ...h.store.get('profile', 'profile')!, id }, h.owner.id);
  const active = ['active-1', 'active-2', 'active-3', 'active-4'].map(id => h.app.request(h.link(id)));
  await began;
  const queued = h.app.request(h.link('queued'));
  // app.request 同步进入路由；队列中的第五次读取尚未触发 fetcher。
  expect(calls).toBe(4);
  h.store.delete('profile', 'queued'); release();
  expect((await queued).status).toBe(404);
  expect((await Promise.all(active)).map(response => response.status)).toEqual([200, 200, 200, 200]);
  expect(calls).toBe(5);
  expect(h.store.db.prepare('SELECT COUNT(*) AS n FROM resource_bindings').get()).toEqual({ n: 4 });
  expect(h.store.db.prepare('SELECT COUNT(*) AS n FROM snapshots').get()).toEqual({ n: 4 });
});
