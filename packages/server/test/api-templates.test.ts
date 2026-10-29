import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { addUser, client, serve, setupApp } from './helpers.ts';

const TEMPLATE = (rulesetId: string) => ({
  name: '标准分流',
  groups: [
    { id: 'sel', name: '🚀 节点选择', type: 'select', members: [{ kind: 'group', groupId: 'hk' }, { kind: 'builtin', name: 'DIRECT' }] },
    { id: 'hk', name: '🇭🇰 香港', type: 'select', members: [] },
  ],
  rules: [{ id: 'r-ai', matcher: { kind: 'ruleset', id: rulesetId }, target: { kind: 'group', groupId: 'sel' } }],
  final: { kind: 'group', groupId: 'sel' },
});

async function scenario() {
  const env = setupApp({ fetcher: serve({ 'https://air.example.com/sub': 'trojan://pw@hk.example.com:443#HK-01\ntrojan://pw@jp.example.com:443#JP-01' }) });
  await addUser(env.store, 'root', 'admin');
  await addUser(env.store, 'alice');
  await addUser(env.store, 'bob');
  const admin = client(env.app);
  const alice = client(env.app);
  const bob = client(env.app);
  await admin.login('root');
  await alice.login('alice');
  await bob.login('bob');
  const rs = (await admin.post('/api/rulesets', { name: 'AI', kind: 'local', format: 'auto', content: '.openai.com\n' })).json.item.id as string;
  const published = await admin.post('/api/templates/new/publish', { ...TEMPLATE(rs), changelog: '初版' });
  const tplId = published.json.item.id as string;
  const src = (await alice.post('/api/sources', { name: '机场', url: 'https://air.example.com/sub', pipeline: [] })).json.item.id as string;
  const profile = (await alice.post('/api/profiles', {
    name: '我的订阅',
    template: { id: tplId, follow: 'latest' },
    nodeSets: [{ ref: { type: 'source', id: src }, output: 'provider' }],
    overlay: {
      groupPatches: { hk: { addMembers: [{ kind: 'nodeset', ref: { type: 'source', id: src } }], set: { filter: 'HK' } } },
      extraGroups: [{ group: { id: 'mine', name: '我的组', type: 'select', members: [{ kind: 'group', groupId: 'hk' }] } }],
    },
  })).json.item.id as string;
  return { ...env, admin, alice, bob, rs, tplId, src, profile, published };
}

describe('模板', () => {
  it('发布和重新读取保留来源顺序，未引用来源不拉取也不生成规则', async () => {
    const { admin, rs, store } = await scenario();
    try {
      const ruleProviders = [
        { name: 'google', url: 'https://example.test/unused-google.list' },
        { name: 'lan', url: 'https://example.test/unused-lan.list' },
      ];
      const saved = await admin.post('/api/templates/new/publish', { ...TEMPLATE(rs), ruleProviders });
      expect(saved.status).toBe(201);
      const id = saved.json.item.id;
      expect(saved.json.item.ruleProviders).toEqual(ruleProviders);
      expect((await admin.get(`/api/templates/${id}`)).json.item.ruleProviders).toEqual(ruleProviders);
      expect((await admin.get(`/api/templates/${id}/versions/1`)).json.item.rules).toEqual(TEMPLATE(rs).rules);
      for (const invalid of [[{ name: 'file', url: 'file:///tmp/rules' }], [ruleProviders[0], ruleProviders[0]], {}]) {
        const result = await admin.post('/api/templates/new/publish', { ...TEMPLATE(rs), ruleProviders: invalid });
        expect(result.status).toBe(400);
        expect(result.json.details.report[0].code).toBe('template.invalid-provider');
      }
    } finally { store.close(); }
  });

  it('管理员发布新模板，所有人可读；普通用户不能发布', async () => {
    const { alice, published, tplId, rs } = await scenario();
    expect(published.status).toBe(201);
    expect(published.json.item.version).toBe(1);
    expect((await alice.get('/api/templates')).json.items.map((t: { id: string }) => t.id)).toEqual([tplId]);
    expect((await alice.post(`/api/templates/${tplId}/publish`, TEMPLATE(rs))).status).toBe(403);
  });

  it('自身校验不通过时禁止发布；编辑器可即时校验', async () => {
    const { admin, tplId, rs } = await scenario();
    const bad = { ...TEMPLATE(rs), rules: [{ id: 'x', matcher: { kind: 'ruleset', id: 'nope' }, target: { kind: 'group', groupId: 'gone' } }] };
    const res = await admin.post(`/api/templates/${tplId}/publish`, bad);
    expect(res.status).toBe(400);
    expect(res.json.details.report.map((i: { code: string }) => i.code).sort()).toEqual(['template.dangling-group', 'template.dangling-ruleset']);
    expect((await admin.post('/api/templates/validate', bad)).json.report).toHaveLength(2);
  });

  it('旧覆盖配置转为独立模式后，模板发布不影响原订阅', async () => {
    const { admin, alice, tplId, rs, profile } = await scenario();
    expect((await alice.get(`/api/profiles/${profile}`)).json.item.routing.mode).toBe('independent');
    const withoutHk = { ...TEMPLATE(rs), groups: [{ id: 'sel', name: '🚀 节点选择', type: 'select', members: [{ kind: 'builtin', name: 'DIRECT' }] }], changelog: '删除香港组' };
    expect((await admin.post(`/api/templates/${tplId}/impact`, withoutHk)).json.impact).toEqual([]);
    expect((await admin.post(`/api/templates/${tplId}/publish`, withoutHk)).status).toBe(200);
    expect((await alice.post(`/api/profiles/${profile}/preview`)).json.ok).toBe(true);
    expect((await admin.get(`/api/templates/${tplId}`)).json.item.version).toBe(2);
  });
});

describe('订阅链接与预览', () => {
  it('创建、重置、删除订阅链接；旧链接立即失效', async () => {
    const { alice, app, profile } = await scenario();
    const created = await alice.post(`/api/profiles/${profile}/tokens`, { label: 'Mac' });
    expect(created.status).toBe(201);
    expect(created.json.item.url).toMatch(/^https:\/\/sub\.test\/sub\/[\w-]+$/);
    const token = created.json.item.token as string;
    expect((await app.request(`/sub/${token}`, { headers: { 'user-agent': 'clash.meta' } })).status).toBe(200);

    const reset = await alice.post(`/api/profiles/${profile}/tokens/${token}/reset`);
    expect(reset.json.item.label).toBe('Mac');
    expect((await app.request(`/sub/${token}`)).status).toBe(404);
    expect((await app.request(`/sub/${reset.json.item.token}`, { headers: { 'user-agent': 'clash.meta' } })).status).toBe(200);

    expect((await alice.get(`/api/profiles/${profile}/tokens`)).json.items).toHaveLength(1);
    expect((await alice.del(`/api/profiles/${profile}/tokens/${reset.json.item.token}`)).status).toBe(200);
    expect((await alice.get(`/api/profiles/${profile}/tokens`)).json.items).toEqual([]);
  });

  it('预览返回配置、依赖节点与报告；可预览未保存的草稿', async () => {
    const { alice, profile, src, tplId } = await scenario();
    const res = await alice.post(`/api/profiles/${profile}/preview`, { platform: 'macos' });
    expect(res.json.ok).toBe(true);
    const cfg = parse(res.json.yaml) as Record<string, any>;
    expect(cfg['proxy-groups'].map((g: { name: string }) => g.name)).toEqual(['🚀 节点选择', '🇭🇰 香港', '我的组']);
    expect(res.json.report).toEqual([]);

    const draft = { name: '我的订阅', template: { id: tplId, follow: 'latest' }, nodeSets: [{ ref: { type: 'source', id: src }, output: 'inline' }], overlay: {} };
    const d = await alice.post(`/api/profiles/${profile}/preview`, { profile: draft });
    expect((parse(d.json.yaml) as Record<string, any>).proxies.map((p: { name: string }) => p.name)).toEqual(['HK-01', 'JP-01']);
    expect(d.json.report.map((i: { code: string }) => i.code)).toEqual(['group.empty']);
  });

  it('别人的 Profile 不能管理链接或预览；预览草稿不能借用别人的节点集', async () => {
    const { bob, profile, src } = await scenario();
    expect((await bob.get(`/api/profiles/${profile}/tokens`)).status).toBe(404);
    expect((await bob.post(`/api/profiles/${profile}/preview`, {})).status).toBe(404);
    const mine = (await bob.post('/api/profiles', { name: 'B', nodeSets: [] })).json.item.id;
    const steal = await bob.post(`/api/profiles/${mine}/preview`, { profile: { name: 'B', nodeSets: [{ ref: { type: 'source', id: src }, output: 'inline' }] } });
    expect(steal.status).toBe(400);
  });

  it('私有规则只能引用自己的或管理员公共的规则集', async () => {
    const { alice, bob, rs } = await scenario();
    const own = (await alice.post('/api/rulesets', { name: '我的', kind: 'local', format: 'auto', content: 'DOMAIN,a.com' })).json.item.id;
    const rule = (id: string) => ({ anchor: 'top', rule: { id: 'p1', matcher: { kind: 'ruleset', id }, target: { kind: 'builtin', name: 'DIRECT' } } });
    expect((await alice.post('/api/profiles', { name: 'A', nodeSets: [], overlay: { extraRules: [rule(own)] } })).status).toBe(201);
    expect((await alice.post('/api/profiles', { name: 'A', nodeSets: [], overlay: { extraRules: [rule(rs)] } })).status).toBe(201);
    expect((await bob.post('/api/profiles', { name: 'B', nodeSets: [], overlay: { extraRules: [rule(own)] } })).status).toBe(400);
  });

  it('访问日志只返回自己 Profile 的', async () => {
    const { alice, app, profile } = await scenario();
    const token = (await alice.post(`/api/profiles/${profile}/tokens`, {})).json.item.token;
    await app.request(`/sub/${token}`, { headers: { 'user-agent': 'FlClash/v0.8.80 Platform/android' } });
    const log = await alice.get(`/api/profiles/${profile}/access-log`);
    expect(log.json.items[0]).toMatchObject({ client: 'mihomo', platform: 'android', status: 200 });
    expect(log.json.items[0].token).not.toBe(token);
  });
});
