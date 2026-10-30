import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { addUser, client, setupApp } from './helpers.ts';
const template = { name: '模板', groups: [
  { id: 'g', name: '香港', type: 'select', members: [{ kind: 'builtin', name: 'DIRECT' }] },
  { id: 'auto', name: '自动', type: 'url-test', members: [{ kind: 'group', groupId: 'g' }] },
], rules: [{ id: 'rule', matcher: { kind: 'rule', rule: { type: 'DOMAIN', value: 'example.com' } }, target: { kind: 'group', groupId: 'g' } }], final: { kind: 'group', groupId: 'auto' } };
async function scenario() {
  const env = setupApp(); await addUser(env.store, 'root', 'admin');
  const user = await addUser(env.store, 'alice'); await addUser(env.store, 'bob');
  const admin = client(env.app), alice = client(env.app), bob = client(env.app);
  await admin.login('root'); await alice.login('alice'); await bob.login('bob');
  const t = (await admin.post('/api/templates/new/publish', template)).json.item;
  const local = (await alice.post('/api/locals', { name: '本地节点', proxies: [{ name: '节点 A', type: 'socks5', server: 'test.local', port: 1080 }] })).json.item;
  const member = { kind: 'nodeset', ref: { type: 'local', id: local.id } };
  const result = await alice.post('/api/profiles', { name: '绑定订阅', nodeSets: [{ ref: member.ref, output: 'provider' }], overlay: {}, chains: [], refPolicy: { default: 'wrap' }, routing: { mode: 'bound', templateId: t.id, groupAdditions: { g: [member] } } });
  expect(result.status).toBe(201);
  return { ...env, admin, alice, bob, t, member, profile: result.json.item, user };
}
describe('模板绑定与独立模式', () => {
  it('绑定、复制和解除关联保留备注，备注不会进入客户端输出', async () => {
    const { alice, profile, app, store } = await scenario();
    try {
      const note = '内部管理备注：日常设备 🌏\n第二行';
      const saved = (await alice.put(`/api/profiles/${profile.id}`, { ...profile, note })).json.item;
      const detached = await alice.post('/api/profiles/routing/convert', { profile: saved, mode: 'independent' });
      expect(detached.status).toBe(200);
      expect(detached.json.item.note).toBe(note);
      const rebound = await alice.post('/api/profiles/routing/convert', { profile: detached.json.item, mode: 'bound', templateId: profile.routing.templateId, mapping: { g: 'g' } });
      expect(rebound.status).toBe(200);
      expect(rebound.json.item.note).toBe(note);
      const copy = await alice.post('/api/profiles/routing/convert', { profile: rebound.json.item, mode: 'independent' });
      expect(copy.status).toBe(200);
      expect(copy.json.item.note).toBe(note);
      expect((await alice.put(`/api/profiles/${profile.id}`, copy.json.item)).status).toBe(200);
      const token = (await alice.get(`/api/profiles/${profile.id}/tokens`)).json.items[0].token;
      const rendered = await app.request(`/sub/${token}`);
      expect(rendered.status).toBe(200);
      expect(await rendered.text()).not.toContain('内部管理备注');
    } finally { store.close(); }
  });
  it('模板更新自动生效且保留补充、链接和历史资源；转换后的配置不随模板变更', async () => {
    const { admin, alice, t, profile, app } = await scenario();
    const token = (await alice.post(`/api/profiles/${profile.id}/tokens`)).json.item.token;
    const before = parse(await (await app.request(`/sub/${token}`)).text());
    const oldResource = new URL((Object.values(before['proxy-providers'])[0] as { url: string }).url);
    expect((await admin.post(`/api/templates/${t.id}/publish`, { ...template, groups: template.groups.map(g => g.id === 'g' ? { ...g, name: '香港新版' } : g), rules: [{ ...template.rules[0], target: { kind: 'builtin', name: 'REJECT' } }] })).status).toBe(200);
    const updated = parse(await (await app.request(`/sub/${token}`)).text());
    expect(updated['proxy-groups'][0]).toMatchObject({ name: '香港新版', use: ['本地节点'] });
    expect(updated.rules[0]).toBe('DOMAIN,example.com,REJECT');
    expect((await app.request(oldResource.pathname + oldResource.search)).status).toBe(200);
    const current = (await alice.get(`/api/profiles/${profile.id}`)).json.item;
    const converted = await alice.post('/api/profiles/routing/convert', { profile: current, mode: 'independent' });
    expect(converted.status).toBe(200); expect(converted.json.item.routing.config.groups[0].members).toHaveLength(2);
    expect((await alice.put(`/api/profiles/${profile.id}`, converted.json.item)).status).toBe(200);
    expect((await admin.post(`/api/templates/${t.id}/publish`, template)).status).toBe(200);
    const final = parse(await (await app.request(`/sub/${token}`)).text());
    expect(final['proxy-groups']).toEqual(updated['proxy-groups']); expect(final.rules).toEqual(updated.rules);
    expect((await alice.get(`/api/profiles/${profile.id}/tokens`)).json.items[0].token).toBe(token);
  });
  it('绑定订阅的删组冲突禁止强制发布；组引用环在保存前拒绝', async () => {
    const { admin, alice, t, profile } = await scenario();
    const deletion = { ...template, groups: [{ ...template.groups[1], members: [{ kind: 'builtin', name: 'DIRECT' }] }], rules: [], force: true };
    const blocked = await admin.post(`/api/templates/${t.id}/publish`, deletion);
    expect(blocked.status).toBe(409); expect(blocked.json.details.impact[0].issues.some((i: any) => i.code === 'binding.orphan')).toBe(true);
    const cycle = { ...profile, routing: { ...profile.routing, groupAdditions: { g: [{ kind: 'group', groupId: 'auto' }] } } };
    expect((await alice.post('/api/profiles/preview', { profile: cycle })).status).toBe(400);
    expect((await admin.get(`/api/templates/${t.id}`)).json.item.groups).toEqual(template.groups);
  });
  it('拒绝模式绕过和覆盖模板字段，允许旧草稿继续保存和转换', async () => {
    const { alice, admin, t, profile } = await scenario();
    for (const extra of [{ overlay: { final: { kind: 'builtin', name: 'REJECT' } } }, { routing: { ...profile.routing, config: { groups: [] } } }, { routing: undefined }]) expect((await alice.put(`/api/profiles/${profile.id}`, { ...profile, ...extra })).status).toBe(400);
    expect((await alice.put(`/api/profiles/${profile.id}`, { ...profile, name: '新名称' })).status).toBe(200);
    expect((await alice.put(`/api/profiles/${profile.id}`, { ...profile, revision: -1, templateVersion: -1 })).status).toBe(200);
    const fresh = (await alice.get(`/api/profiles/${profile.id}`)).json.item;
    expect((await admin.post(`/api/templates/${t.id}/publish`, template)).status).toBe(200);
    expect((await alice.put(`/api/profiles/${profile.id}`, fresh)).status).toBe(200);
    const converted = await alice.post('/api/profiles/routing/convert', { profile: fresh, mode: 'independent', currentTemplateVersion: -1 });
    expect(converted.status).toBe(200);
    expect(converted.json.item).not.toHaveProperty('revision');
    expect(converted.json.item).not.toHaveProperty('templateVersion');
    expect(fresh).not.toHaveProperty('revision');
    expect(fresh).not.toHaveProperty('templateVersion');
  });
  it('重新绑定需要明确映射，草稿不落库，保留成员且检查归属', async () => {
    const { alice, bob, admin, profile } = await scenario();
    const detached = (await alice.post('/api/profiles/routing/convert', { profile, mode: 'independent' })).json.item;
    const independent = (await alice.put(`/api/profiles/${profile.id}`, detached)).json.item;
    const target = (await admin.post('/api/templates/new/publish', { ...template, groups: [{ ...template.groups[0], id: 'new' }], rules: [], final: { kind: 'group', groupId: 'new' } })).json.item;
    const request = { profile: independent, mode: 'bound', templateId: target.id, mapping: {} };
    expect((await alice.post('/api/profiles/routing/convert', request)).status).toBe(400);
    expect((await admin.put(`/api/templates/${target.id}`, { ...target, name: '修改后的目标模板' })).status).toBe(200);
    const mapped = await alice.post('/api/profiles/routing/convert', { ...request, templateVersion: -1, mapping: { g: 'new' } });
    expect(mapped.status).toBe(200); expect(mapped.json.item.routing.groupAdditions.new).toHaveLength(1);
    expect((await alice.get(`/api/profiles/${profile.id}`)).json.item.routing.mode).toBe('independent');
    expect((await alice.put(`/api/profiles/${profile.id}`, mapped.json.item)).status).toBe(200);
    expect((await bob.post('/api/profiles/routing/convert', request)).status).toBe(404);
    expect((await bob.get(`/api/profiles/${profile.id}/migration-backup`)).status).toBe(404);
  });
  it('独立配置中的规则集继续更新并阻止删除被引用的资源', async () => {
    const { alice, store, profile, user, renderer } = await scenario();
    store.put('ruleset', { id: 'rs', name: '规则', sources: [{ id: 's', kind: 'local', format: 'auto', content: 'DOMAIN,one.test' }] }, user.id);
    const detached = (await alice.post('/api/profiles/routing/convert', { profile, mode: 'independent' })).json.item;
    detached.routing.config.rules = [{ id: 'rs-rule', matcher: { kind: 'ruleset', id: 'rs' }, target: { kind: 'builtin', name: 'DIRECT' } }];
    expect((await alice.put(`/api/profiles/${profile.id}`, detached)).status).toBe(200);
    const before = await renderer.render(profile.id, { client: 'mihomo' });
    expect(before.ok && Object.values(before.render.rulesets).join('')).toContain('one.test');
    store.put('ruleset', { id: 'rs', name: '规则', sources: [{ id: 's', kind: 'local', format: 'auto', content: 'DOMAIN,two.test' }] }, user.id);
    const after = await renderer.render(profile.id, { client: 'mihomo' });
    expect(after.ok && Object.values(after.render.rulesets).join('')).toContain('two.test');
    expect((await alice.del('/api/rulesets/rs')).status).toBe(409);
  });
});

it('发布时检查模板与追加成员合并后的环，并在异常版本进入存储后沿用上次成功输出', async () => {
  const { admin, alice, t, profile, store, renderer } = await scenario();
  const first = { ...template, groups: template.groups.map(g => ({ ...g, members: [{ kind: 'builtin', name: 'DIRECT' }] })) };
  expect((await admin.post(`/api/templates/${t.id}/publish`, first)).status).toBe(200);
  const current = (await alice.get(`/api/profiles/${profile.id}`)).json.item;
  current.routing.groupAdditions.auto = [{ kind: 'group', groupId: 'g' }];
  expect((await alice.put(`/api/profiles/${profile.id}`, current)).status).toBe(200);
  const next = { ...first, groups: first.groups.map(g => g.id === 'g' ? { ...g, members: [{ kind: 'group', groupId: 'auto' }] } : g) };
  const blocked = await admin.post(`/api/templates/${t.id}/publish`, { ...next, force: true });
  expect(blocked.status).toBe(409);
  expect(blocked.json.details.impact[0].issues.some((i: any) => i.code === 'binding.group-cycle')).toBe(true);
  const good = await renderer.render(profile.id, { client: 'mihomo' });
  store.putTemplateVersion({ id: t.id, version: 3, ...next } as any);
  const fallback = await renderer.render(profile.id, { client: 'mihomo' });
  expect(fallback.ok && fallback.source).toBe('last-good');
  expect(fallback.ok && fallback.render.yaml).toBe(good.ok && good.render.yaml);
});

it('模板影响检查期间有订阅保存时，模板仍可正常保存', async () => {
  const { admin, alice, t, profile, renderer } = await scenario();
  const original = renderer.preview.bind(renderer);
  let changed = false;
  renderer.preview = async (...args) => {
    const result = await original(...args);
    if (!changed) { changed = true; expect((await alice.put(`/api/profiles/${profile.id}`, { ...profile, name: '并发修改' })).status).toBe(200); }
    return result;
  };
  const published = await admin.post(`/api/templates/${t.id}/publish`, template);
  expect(published.status).toBe(200);
  expect((await admin.get(`/api/templates/${t.id}`)).json.item.groups).toEqual(template.groups);
});

it.each([false, true])('代理链前置节点在保存、解除绑定与重新绑定时保留（全部来源：%s）', async all => {
  const { alice, profile, member, renderer } = await scenario();
  const via = (await alice.post('/api/locals', { name: '代理链前置节点', proxies: [{ name: '前置', type: 'socks5', server: 'via.test', port: 1080 }] })).json.item;
  profile.nodeSets.push({ ref: { type: 'local', id: via.id }, output: 'provider' });
  profile.chains = [{ id: 'chain', landing: { nodeSet: member.ref }, via: { kind: 'node', ref: { nodeSet: all ? { type: 'all', id: 'provider' } : { type: 'local', id: via.id }, match: { exact: '前置' }, fallback: 'error' } } }];
  const saved = await alice.put(`/api/profiles/${profile.id}`, profile);
  expect(saved.status).toBe(200);
  const detached = await alice.post('/api/profiles/routing/convert', { profile: saved.json.item, mode: 'independent' });
  expect(detached.status).toBe(200);
  expect(detached.json.item.chains).toEqual(profile.chains);
  expect((await alice.put(`/api/profiles/${profile.id}`, detached.json.item)).status).toBe(200);
  const rendered = await renderer.render(profile.id, { client: 'mihomo' });
  expect(rendered.ok, JSON.stringify(rendered.report)).toBe(true);
  expect(rendered.ok && Object.values(rendered.render.providers).join('\n')).toContain('dialer-proxy: __ref_');
  const independent = (await alice.get(`/api/profiles/${profile.id}`)).json.item;
  const rebound = await alice.post('/api/profiles/routing/convert', { profile: independent, mode: 'bound', templateId: profile.routing.templateId, mapping: { g: 'g' } });
  expect(rebound.status).toBe(200);
  expect(rebound.json.item.chains).toEqual(profile.chains);
});

it('绑定订阅的独立策略组可保存、导出、随模板更新保留并在转换中保留引用', async () => {
  const { alice, admin, t, member, profile, renderer } = await scenario();
  const group = { id: 'private', name: '独立机场', type: 'select', members: [member, { kind: 'group', groupId: 'g' }] };
  profile.routing.extraGroups = [group];
  profile.routing.prependRules = [{ id: 'private-rule', matcher: { kind: 'rule', rule: { type: 'DOMAIN', value: 'private.test' } }, target: { kind: 'group', groupId: group.id } }];
  expect((await alice.put(`/api/profiles/${profile.id}`, profile)).status).toBe(200);
  expect((await admin.post(`/api/templates/${t.id}/publish`, { ...template, groups: template.groups.map(g => ({ ...g, name: `${g.name}新版` })) })).status).toBe(200);
  const saved = (await alice.get(`/api/profiles/${profile.id}`)).json.item;
  expect(saved.routing.extraGroups).toEqual([group]);
  for (const client of ['mihomo', 'stash'] as const) {
    const rendered = await renderer.render(profile.id, { client });
    expect(rendered.ok, JSON.stringify(rendered.report)).toBe(true);
    if (!rendered.ok) throw new Error('生成失败');
    const config = parse(rendered.render.yaml);
    expect(config['proxy-groups']).toContainEqual(expect.objectContaining({ name: group.name }));
    expect(config.rules).toContain('DOMAIN,private.test,独立机场');
  }
  const target = (await admin.post('/api/templates/new/publish', { ...template, groups: [{ ...template.groups[0], id: 'new' }], rules: [], final: { kind: 'group', groupId: 'new' } })).json.item;
  const rebound = await alice.post('/api/profiles/routing/convert', { profile: saved, mode: 'bound', templateId: target.id, mapping: { g: 'new' } });
  expect(rebound.status).toBe(200);
  expect(rebound.json.item.routing.extraGroups[0].members).toEqual([member, { kind: 'group', groupId: 'new' }]);
  expect(rebound.json.item.routing.prependRules[0].target.groupId).toBe('private');
  const detached = await alice.post('/api/profiles/routing/convert', { profile: saved, mode: 'independent' });
  expect(detached.status).toBe(200);
  expect(detached.json.item.routing.config.groups.at(-1)).toEqual(group);
});

it('独立组拒绝重名、ID 覆盖、非法成员和循环；模板发布也检查新增组冲突', async () => {
  const { alice, admin, t, member, profile } = await scenario();
  const group = { id: 'private', name: '独立机场', type: 'select', members: [member] };
  for (const invalid of [null, { ...group, members: null }, { ...group, members: [null] }, { ...group, id: 'g' }, { ...group, name: '香港' }, { ...group, members: [{ kind: 'nodeset', ref: { type: 'local', id: 'missing' } }] }, { ...group, members: [{ kind: 'group', groupId: 'private' }] }]) {
    const response = await alice.put(`/api/profiles/${profile.id}`, { ...profile, routing: { ...profile.routing, extraGroups: [invalid] } });
    expect(response.status, JSON.stringify(response.json)).toBe(400);
  }
  expect((await alice.put(`/api/profiles/${profile.id}`, { ...profile, routing: { ...profile.routing, extraGroups: [group] } })).status).toBe(200);
  const collision = await admin.post(`/api/templates/${t.id}/publish`, { ...template, groups: [...template.groups, { ...group, members: [] }], force: true });
  expect(collision.status).toBe(409);
});
