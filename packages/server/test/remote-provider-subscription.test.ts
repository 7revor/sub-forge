import { afterEach, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { parseContent, type Client } from '@sub-forge/core';
import { addUser, setupApp } from './helpers.ts';
import type { StoredRender } from '../src/render.ts';

const envs: ReturnType<typeof setupApp>[] = [];
afterEach(async () => { for (const h of envs.splice(0)) { await h.snapshots.settled(); h.store.close(); } });
const ref = { type: 'source' as const, id: 'source' };
const proxy = (name: string) => ({ name, type: 'ss', server: 'node.example.test', port: 443, cipher: 'aes-128-gcm', password: 'fixture-password' });
async function setup() {
  let nodes = [proxy('香港'), proxy('日本')];
  const h = setupApp({ fetcher: async url => {
    if (url !== 'https://upstream.example.test/private') throw new Error('未声明的测试上游');
    return { status: 200, body: stringify({ proxies: nodes }), userinfo: { total: 10000, download: 100 } };
  } }); envs.push(h);
  const user = await addUser(h.store, 'alice'), other = await addUser(h.store, 'bob');
  h.store.put('source', { id: ref.id, name: '机场', url: 'https://upstream.example.test/private', pipeline: [{ op: 'rename.affix', prefix: '处理-' }] }, user.id);
  h.store.put('local', { id: 'inline', name: '展开来源', proxies: [proxy('本地')] }, user.id);
  h.store.put('profile', { id: 'p', name: '远程验收', nodeSets: [{ ref, output: 'provider' }, { ref: { type: 'local', id: 'inline' }, output: 'inline' }], chains: [],
    routing: { mode: 'independent', config: { groups: [{ id: 'g', name: '代理', type: 'select', members: [{ kind: 'nodeset', ref }], filter: '香港' }], rules: [], final: { kind: 'group', groupId: 'g' } } },
  }, user.id);
  return { ...h, user, token: h.store.createToken(user.id).token, otherToken: h.store.createToken(other.id).token, update: (next: typeof nodes) => { nodes = next; h.advance(86400 * 1000 + 1); } };
}
const decodeNodes = (client: Client, body: string) => client === 'stash' ? parse(body).proxies : parseContent(body, ref).proxies;
const links = (body: string) => [...body.matchAll(/https:\/\/sub\.test\/subs\/nodes\?[^\s,\n]+/g)].map(m => m[0]);
for (const target of ['surge', 'loon', 'stash'] as const) describe(target + ' 远程节点接口', () => {
  it('主订阅使用原生远程入口，资源为处理后的指定节点，HEAD、流量头、鉴权与撤销有效', async () => {
    const h = await setup();
    const response = await h.app.request(`/subs/profile?id=p&token=${h.token}&target=${target}&platform=ios`);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toContain('upstream.example.test');
    expect(body).not.toContain('处理-香港');
    const url = links(body).find(link => new URL(link).searchParams.get('id')!.startsWith('view:'))!;
    expect(url).toBeDefined();
    expect(new URL(url).searchParams.get('target')).toBe(target);
    expect(new URL(url).searchParams.get('app')).toBe(`${target}-ios`);
    const resource = await h.app.request(url);
    expect(resource.status).toBe(200);
    expect(resource.headers.get('subscription-userinfo')).toContain('total=10000');
    expect(decodeNodes(target, await resource.text()).map((n: any) => n.name)).toEqual(['处理-香港']);
    const head = await h.app.request(url, { method: 'HEAD' });
    expect(head.status).toBe(200); expect(await head.text()).toBe('');
    expect(head.headers.get('subscription-userinfo')).toContain('download=100');
    const other = new URL(url); other.searchParams.set('token', h.otherToken);
    expect((await h.app.request(other.href)).status).toBe(404);
    const mismatch = new URL(url); mismatch.searchParams.set('app', 'mihomo');
    expect((await h.app.request(mismatch.href)).status).toBe(404);
    h.store.deleteToken(h.token);
    expect((await h.app.request(url)).status).toBe(404);
  });
  it('同一个远程链接更新成员，筛空不下发空集合，切换展开后旧资源失效', async () => {
    const h = await setup();
    const main = `/subs/profile?id=p&token=${h.token}&target=${target}&platform=ios`;
    const url = links(await (await h.app.request(main)).text()).find(link => new URL(link).searchParams.get('id')!.startsWith('view:'))!;
    h.update([proxy('香港'), proxy('香港 2'), proxy('日本')]);
    const updated = await h.app.request(url);
    expect(updated.status).toBe(200);
    expect(decodeNodes(target, await updated.text()).map((n: any) => n.name)).toEqual(['处理-香港', '处理-香港 2']);
    h.update([proxy('日本')]);
    expect((await h.app.request(url)).status).toBe(404);
    const empty = await (await h.app.request(main)).text();
    if (target === 'stash') expect(parse(empty)['proxy-groups'][0].proxies).toEqual(['REJECT']);
    else expect(empty).toContain('代理 = select, REJECT');
    const profile = h.store.get('profile', 'p')!; profile.nodeSets[0]!.output = 'inline'; h.store.put('profile', profile, h.user.id);
    expect((await h.app.request(url)).status).toBe(404);
    const inline = await (await h.app.request(main)).text();
    expect(links(inline)).toEqual([]);
    expect(inline).toContain('处理-日本');
  });
  it('来源流水线筛空时原始远程资源返回 503，主订阅拒绝连接', async () => {
    const h = await setup();
    const profile = h.store.get('profile', 'p')!;
    if (profile.routing.mode !== 'independent') throw new Error('测试配置必须使用独立分流');
    delete profile.routing.config.groups[0]!.filter;
    h.store.put('profile', profile, h.user.id);
    const main = `/subs/profile?id=p&token=${h.token}&target=${target}&platform=ios`;
    const url = links(await (await h.app.request(main)).text())[0]!;
    expect(url).toBeDefined();
    const source = h.store.get('source', ref.id)!;
    source.pipeline.push({ op: 'filter.regex', patterns: ['不匹配任何节点'], keep: true });
    h.store.put('source', source, h.user.id);
    const resource = await h.app.request(url);
    expect(resource.status).toBe(503);
    expect(await resource.text()).toContain('节点集合为空');
    const body = await (await h.app.request(main)).text();
    expect(links(body)).toEqual([]);
    if (target === 'stash') expect(parse(body)['proxy-groups'][0].proxies).toEqual(['REJECT']);
    else expect(body).toContain('代理 = select, REJECT');
  });
  it('草稿保留远程引用并禁用含占位地址的导出，选择展开后恢复独立文件', async () => {
    const h = await setup();
    const preview = await h.renderer.preview('p', { client: target, platform: 'ios' });
    expect(preview.ok).toBe(true);
    expect(preview.exportUnavailableReason).toContain('远程节点引用');
    expect(preview.exportYaml).toBeUndefined();
    expect(links(preview.yaml!)).not.toEqual([]);
    expect(h.store.getLastGood('p', `${target}:ios:${target}-ios`)).toBeUndefined();
    const profile = h.store.get('profile', 'p')!; profile.nodeSets[0]!.output = 'inline';
    const inline = await h.renderer.preview('p', { client: target, platform: 'ios' }, { profile });
    expect(inline.ok).toBe(true); expect(inline.exportUnavailableReason).toBeUndefined();
    expect(inline.exportYaml ?? inline.yaml).not.toContain('__SF_TOKEN__');
  });
  it('失败时不能复活旧强制内联结果，也不能回退到不同输出设置', async () => {
    const h = await setup(), client = { client: target, platform: 'ios' as const }, key = `${target}:ios:${target}-ios`;
    expect((await h.renderer.render('p', client)).ok).toBe(true);
    const saved = h.store.getLastGood<StoredRender>('p', key)!;
    const { nodeProviderDelivery: _version, ...old } = saved.data;
    h.store.putLastGood('p', key, old);
    const profile = h.store.get('profile', 'p')!;
    profile.base = { kernels: { [target === 'stash' ? 'mihomo' : target]: target === 'stash' ? 'proxies: []' : '[Proxy]\n非法 = direct' } };
    h.store.put('profile', profile, h.user.id);
    expect((await h.renderer.render('p', client)).ok).toBe(false);
    h.store.putLastGood('p', key, saved.data);
    profile.nodeSets[0]!.output = 'inline'; h.store.put('profile', profile, h.user.id);
    expect((await h.renderer.render('p', client)).ok).toBe(false);
  });
});

it('Stash 正式订阅使用公共策略组前置，并返回带相同 dialer-proxy 的节点资源', async () => {
  const h = await setup(), profile = h.store.get('profile', 'p')!;
  profile.nodeSets[1]!.output = 'provider';
  profile.chains = [{ id: 'chain', landing: { nodeSet: { type: 'local', id: 'inline' } }, via: { kind: 'group', groupId: 'g' } }];
  h.store.put('profile', profile, h.user.id);
  const generated = await h.renderer.render('p', { client: 'stash', platform: 'ios' });
  expect(generated.ok).toBe(true);
  expect(generated.report.some(item => item.code.startsWith('stash.provider-chain'))).toBe(false);
  const main = await h.app.request(`/subs/profile?id=p&token=${h.token}&target=stash&platform=ios`);
  expect(main.status).toBe(200);
  const url = parse(await main.text())['proxy-providers']['展开来源'].url;
  const resource = await h.app.request(url);
  expect(resource.status).toBe(200);
  expect(parse(await resource.text()).proxies).toMatchObject([{ name: '本地', 'dialer-proxy': '代理' }]);
});

it('Stash 失败不回退旧专用生成器的成功缓存', async () => {
  const h = await setup(), target = { client: 'stash' as const, platform: 'ios' as const };
  expect((await h.renderer.render('p', target)).ok).toBe(true);
  const key = 'stash:ios:stash-ios', saved = h.store.getLastGood<StoredRender>('p', key)!;
  const { clashDelivery: _version, ...legacy } = saved.data;
  h.store.putLastGood('p', key, legacy);
  const profile = h.store.get('profile', 'p')!;
  profile.base = { clients: { 'stash-ios': 'proxies: []' } };
  h.store.put('profile', profile, h.user.id);
  expect((await h.renderer.render('p', target)).ok).toBe(false);
  h.store.putLastGood('p', key, saved.data);
  expect(await h.renderer.render('p', target)).toMatchObject({ ok: true, source: 'last-good' });
});
