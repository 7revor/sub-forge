import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { addUser, client, setupApp } from './helpers.ts';

const envs: ReturnType<typeof setupApp>[] = [];
afterEach(async () => { for (const env of envs.splice(0)) { await env.snapshots.settled(); env.store.close(); } });
const template = { name: '前置规则模板', groups: [{ id: 'g', name: '默认组', type: 'select', members: [{ kind: 'builtin', name: 'DIRECT' }] }],
  rules: [{ id: 'template-rule', matcher: { kind: 'rule', rule: { type: 'DOMAIN-SUFFIX', value: 'example.test' } }, target: { kind: 'group', groupId: 'g' } }], final: { kind: 'group', groupId: 'g' } };
const rule = (id = 'pre-first', target: unknown = { kind: 'builtin', name: 'DIRECT' }) => ({ id, matcher: { kind: 'rule', rule: { type: 'DOMAIN', value: `${id}.example.test` } }, target });
async function setup() {
  const env = setupApp({ fetcher: async () => ({ status: 200, body: 'proxies:\n- { name: 远端节点, type: socks5, server: relay.example.test, port: 1080 }\n' }) });
  envs.push(env);
  await addUser(env.store, 'admin', 'admin'); await addUser(env.store, 'alice'); await addUser(env.store, 'bob');
  const admin = client(env.app), alice = client(env.app), bob = client(env.app);
  await admin.login('admin'); await alice.login('alice'); await bob.login('bob');
  const t = (await admin.post('/api/templates/new/publish', template)).json.item;
  const source = (await alice.post('/api/sources', { name: '远端 provider', url: 'https://nodes.example.test/sub', pipeline: [] })).json.item;
  const draft = { name: '绑定订阅', nodeSets: [{ ref: { type: 'source', id: source.id }, output: 'provider' }], chains: [], overlay: {}, refPolicy: { default: 'wrap' }, templateVersion: 1,
    routing: { mode: 'bound', templateId: t.id, groupAdditions: {}, prependRules: [rule(), rule('pre-node', { kind: 'node', ref: { nodeSet: { type: 'source', id: source.id }, match: { exact: '远端节点' }, fallback: { kind: 'builtin', name: 'REJECT' } } })] } };
  return { ...env, admin, alice, bob, t, draft };
}

describe('绑定模板订阅的前置规则接口', () => {
  it('保存、重读、草稿预览与实际订阅共享顺序和远端节点依赖', async () => {
    const { alice, draft, app, renderer } = await setup();
    const created = await alice.post('/api/profiles', draft);
    expect(created.status).toBe(201);
    const profile = created.json.item;
    expect((await alice.get(`/api/profiles?id=${profile.id}`)).json.item.routing.prependRules).toEqual(draft.routing.prependRules);
    const preview = await alice.post('/api/profiles/preview', { profile });
    expect(preview.status).toBe(200); expect(preview.json.ok).toBe(true);
    const dep = preview.json.dependencies[0];
    expect(dep).toMatchObject({ node: '远端节点', strategy: 'wrap', usedBy: ['rule:pre-node'] });
    const token = (await alice.get(`/api/profiles/link?id=${profile.id}`)).json.item.token;
    const yaml = parse(await (await app.request(`/subs/profile?token=${token}&id=${profile.id}`)).text());
    expect(yaml.rules).toEqual(['DOMAIN,pre-first.example.test,DIRECT', `DOMAIN,pre-node.example.test,${dep.output}`, 'DOMAIN-SUFFIX,example.test,默认组', 'MATCH,默认组']);
    expect(yaml['proxy-groups']).toContainEqual(expect.objectContaining({ name: dep.output, hidden: true }));
    const rendered = await renderer.render(profile.id, { client: 'mihomo' });
    expect(rendered.ok).toBe(true);
  });

  it('模板更新与转为独立配置后保留前置规则；重绑模板时映射前置出口', async () => {
    const { alice, admin, draft, t } = await setup();
    draft.routing.prependRules[0]!.target = { kind: 'group', groupId: 'g' };
    let profile = (await alice.post('/api/profiles', draft)).json.item;
    expect((await admin.post(`/api/templates/${t.id}/publish`, { ...template, rules: [rule('new-template'), ...template.rules] })).status).toBe(200);
    profile = (await alice.get(`/api/profiles?id=${profile.id}`)).json.item;
    const preview = await alice.post('/api/profiles/preview', { profile });
    expect(parse(preview.json.yaml).rules.slice(0, 3)).toEqual(['DOMAIN,pre-first.example.test,默认组', expect.stringMatching(/^DOMAIN,pre-node/), 'DOMAIN,new-template.example.test,DIRECT']);
    const converted = await alice.post('/api/profiles/routing/convert', { profile, mode: 'independent', currentTemplateVersion: 2 });
    expect(converted.status).toBe(200);
    expect(converted.json.item.routing.config.rules.slice(0, 2)).toEqual(profile.routing.prependRules);
    const second = (await admin.post('/api/templates/new/publish', { ...template, groups: [{ ...template.groups[0], id: 'new-g', name: '新组' }], rules: [], final: { kind: 'group', groupId: 'new-g' } })).json.item;
    const rebound = await alice.post('/api/profiles/routing/convert', { profile, mode: 'bound', currentTemplateVersion: 2, templateId: second.id, templateVersion: 1, mapping: { g: 'new-g' } });
    expect(rebound.status).toBe(200);
    expect(rebound.json.item.routing.prependRules[0].target).toEqual({ kind: 'group', groupId: 'new-g' });
    expect(rebound.json.item.routing.prependRules[1]).toEqual(profile.routing.prependRules[1]);
  });

  it('模板发布不能强制删除前置规则引用的组或引入重复规则 ID', async () => {
    const { alice, admin, draft, t } = await setup();
    draft.routing.prependRules[0]!.target = { kind: 'group', groupId: 'g' };
    expect((await alice.post('/api/profiles', draft)).status).toBe(201);
    for (const next of [
      { ...template, groups: [], rules: [], final: { kind: 'builtin', name: 'DIRECT' } },
      { ...template, rules: [rule(), ...template.rules] },
    ]) {
      const response = await admin.post(`/api/templates/${t.id}/publish`, { ...next, force: true });
      expect(response.status).toBe(409);
      expect(response.json.details.impact[0].forceable).toBe(false);
    }
    expect((await admin.get(`/api/templates?id=${t.id}`)).json.item).toEqual(t);
  });

  it('拒绝不存在的规则集、非法规则、插入位置及模板覆盖，保存失败不落库', async () => {
    const { alice, draft } = await setup();
    for (const prependRules of [null, {}, [{ ...rule(), matcher: { kind: 'ruleset', id: 'fake' } }], [rule('template-rule')], [rule(), rule()], [{ ...rule(), anchor: 'bottom' }], [{ ...rule(), matcher: { kind: 'rule', rule: { type: 'MATCH', value: 'REJECT' } } }], [{ ...rule(), matcher: { kind: 'rule', rule: { type: 'DOMAIN', value: '' } } }], [{ ...rule(), matcher: { kind: 'rule', rule: { type: 'DOMAIN', value: 'a\nMATCH,DIRECT' } } }]]) {
      const response = await alice.post('/api/profiles', { ...draft, routing: { ...draft.routing, prependRules } });
      expect(response.status).toBe(400);
    }
    for (const override of [{ overlay: { final: { kind: 'builtin', name: 'REJECT' } } }, { routing: { ...draft.routing, rulePatches: {} } }]) expect((await alice.post('/api/profiles', { ...draft, ...override })).status).toBe(400);
    expect((await alice.get('/api/profiles')).json.items).toEqual([]);
  });

  it('规则的节点、兜底组和所有权在保存与预览前校验', async () => {
    const { alice, bob, draft } = await setup();
    const foreign = (await bob.post('/api/locals', { name: '别人的节点', proxies: [] })).json.item;
    const targets = [undefined, { kind: 'node' }, { kind: 'group', groupId: 'gone' }, { kind: 'node', ref: { nodeSet: { type: 'local', id: foreign.id }, match: { exact: '节点' } } }, { kind: 'node', ref: { nodeSet: draft.nodeSets[0]!.ref, match: { exact: '远端节点' }, fallback: { kind: 'group', groupId: 'gone' } } }];
    for (const target of targets) {
      const profile = { ...draft, routing: { ...draft.routing, prependRules: [{ ...rule('invalid'), target }] } };
      expect((await alice.post('/api/profiles', profile)).status).toBe(400);
      expect((await alice.post('/api/profiles/preview', { profile })).status).toBe(400);
    }
  });
});

it('前置单条规则跟随公共 RAW 编辑器保存与输出，空值及多行仍拒绝', async () => {
  const { alice, draft } = await setup();
  const profile = { ...draft, routing: { ...draft.routing, prependRules: [{ ...rule('raw'), matcher: { kind: 'rule', rule: { type: 'RAW', text: 'DOMAIN,raw.example.test' } } }] } };
  const saved = await alice.post('/api/profiles', profile);
  expect(saved.status).toBe(201);
  const preview = await alice.post('/api/profiles/preview', { profile: saved.json.item });
  expect(preview.json.ok).toBe(true);
  expect(parse(preview.json.yaml).rules[0]).toBe('DOMAIN,raw.example.test,DIRECT');
  for (const text of ['', 'DOMAIN,a.test\nDOMAIN,b.test']) {
    const invalid = { ...profile, routing: { ...profile.routing, prependRules: [{ ...rule('raw'), matcher: { kind: 'rule', rule: { type: 'RAW', text } } }] } };
    expect((await alice.post('/api/profiles', invalid)).status).toBe(400);
    expect((await alice.post('/api/profiles/preview', { profile: invalid })).status).toBe(400);
  }
});

it('前后自定义规则及策略组保存、实际输出、模板更新与转换均保留顺序', async () => {
  const { alice, admin, draft, t, app } = await setup();
  const custom = (id: string) => ({ id, name: id, type: 'select', members: [{ kind: 'builtin', name: 'DIRECT' }] });
  const saved = await alice.post('/api/profiles', { ...draft, routing: { ...draft.routing,
    prependRules: [rule('before')], appendRules: [rule('after', { kind: 'group', groupId: 'g' })],
    extraGroups: [custom('first'), custom('last')], prependGroupIds: ['first'],
  } });
  expect(saved.status).toBe(201);
  const profile = (await alice.get(`/api/profiles?id=${saved.json.item.id}`)).json.item;
  expect(profile.routing).toEqual(saved.json.item.routing);
  const token = (await alice.get(`/api/profiles/link?id=${profile.id}`)).json.item.token;
  const output = parse(await (await app.request(`/subs/profile?token=${token}&id=${profile.id}`)).text());
  expect(output.rules).toEqual(['DOMAIN,before.example.test,DIRECT', 'DOMAIN-SUFFIX,example.test,默认组', 'DOMAIN,after.example.test,默认组', 'MATCH,默认组']);
  expect(output['proxy-groups'].map((g: { name: string }) => g.name)).toEqual(['first', '默认组', 'last']);
  expect((await admin.post(`/api/templates/${t.id}/publish`, { ...template, rules: [rule('new'), ...template.rules] })).status).toBe(200);
  const converted = await alice.post('/api/profiles/routing/convert', { profile, mode: 'independent' });
  expect(converted.status).toBe(200);
  expect(converted.json.item.routing.config.rules.map((r: { id: string }) => r.id)).toEqual(['before', 'new', 'template-rule', 'after']);
  expect(converted.json.item.routing.config.groups.map((g: { id: string }) => g.id)).toEqual(['first', 'g', 'last']);
  const second = (await admin.post('/api/templates/new/publish', { ...template, groups: [{ ...template.groups[0], id: 'g2' }], rules: [], final: { kind: 'group', groupId: 'g2' } })).json.item;
  const rebound = await alice.post('/api/profiles/routing/convert', { profile, mode: 'bound', templateId: second.id, mapping: { g: 'g2' } });
  expect(rebound.status).toBe(200);
  expect(rebound.json.item.routing).toMatchObject({ prependGroupIds: ['first'], appendRules: [{ id: 'after', target: { kind: 'group', groupId: 'g2' } }] });
  // 后置出口与前置出口具有相同的模板发布保护。
  const blocked = await admin.post(`/api/templates/${t.id}/publish`, { ...template, groups: [], rules: [], final: { kind: 'builtin', name: 'DIRECT' }, force: true });
  expect(blocked.status).toBe(409);
});

it('拒绝非法后置规则和伪造的模板内部插入位置', async () => {
  const { alice, draft } = await setup();
  for (const patch of [
    { appendRules: null }, { appendRules: [rule('template-rule')] }, { appendRules: [rule('pre-first')] },
    { appendRules: [{ ...rule('after'), anchor: { after: 'template-rule' } }] },
    { appendRules: [{ ...rule('after'), target: { kind: 'group', groupId: 'gone' } }] },
    { prependGroupIds: ['g'] }, { prependGroupIds: ['gone'] }, { prependGroupIds: 'g' },
  ]) expect((await alice.post('/api/profiles', { ...draft, routing: { ...draft.routing, ...patch } })).status).toBe(400);
});
