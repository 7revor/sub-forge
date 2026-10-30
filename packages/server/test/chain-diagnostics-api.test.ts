import { afterEach, expect, it } from 'vitest';
import { addUser, client, setupApp } from './helpers.ts';
const envs: ReturnType<typeof setupApp>[] = [];
afterEach(async () => { for (const e of envs.splice(0)) { await e.snapshots.settled(); e.store.close(); } });
it('保存规范化旧策略，草稿诊断返回实际前置、缺失与环且不改已保存配置', async () => {
  const env = setupApp(); envs.push(env); await addUser(env.store, 'alice');
  const user = client(env.app); await user.login('alice');
  const local = (await user.post('/api/locals', { name: '节点集', proxies: [{ name: '前置', type: 'socks5', server: 'relay.test', port: 1080 }, { name: '落地', type: 'socks5', server: 'landing.test', port: 1080 }] })).json.item;
  const ref = { type: 'local', id: local.id };
  const via = { kind: 'node', ref: { nodeSet: ref, match: { regex: '^前置$' } } };
  const body = { name: '自动引用', nodeSets: [{ ref, output: 'provider' }], overlay: {}, refPolicy: { default: 'copy', perRef: { fake: 'inline' } }, chains: [{ id: 'c', landing: { nodeSet: ref, filter: '^落地$' }, via }], routing: { mode: 'independent', config: { groups: [], rules: [], final: { kind: 'builtin', name: 'DIRECT' } } } };
  const saved = await user.post('/api/profiles', body); expect(saved.status).toBe(201);
  const profile = saved.json.item;
  expect(profile.refPolicy).toEqual({ default: 'wrap' });
  const preview = await user.post(`/api/profiles/${profile.id}/preview`, { profile, client: 'mihomo' });
  expect(preview.json.chainResolutions).toEqual([{ chainId: 'c', viaName: '前置', landingCount: 1, appliedCount: 1, issues: [] }]);
  expect(preview.json.dependencies[0].strategy).toBe('wrap');
  const missing = await user.post(`/api/profiles/${profile.id}/preview`, { profile: { ...profile, chains: [{ ...profile.chains[0], via: { ...via, ref: { ...via.ref, match: { exact: '不存在' } } } }] } });
  expect(missing.json.ok).toBe(false);
  expect(missing.json.chainResolutions[0]).toMatchObject({ appliedCount: 0, issues: [expect.objectContaining({ code: 'ref.unresolved' })] });
  const cycle = await user.post(`/api/profiles/${profile.id}/preview`, { profile: { ...profile, chains: [{ ...profile.chains[0], landing: { nodeSet: ref } }] } });
  expect(cycle.json.ok).toBe(false); expect(cycle.json.chainResolutions[0].issues.some((r: any) => r.code === 'chain.cycle')).toBe(true);
  expect((await user.get(`/api/profiles/${profile.id}`)).json.item.chains).toEqual(profile.chains);
  const stash = await user.post(`/api/profiles/${profile.id}/preview`, { profile, client: 'stash', platform: 'ios' });
  expect(stash.json.ok).toBe(true); expect(stash.json.chainResolutions[0].viaName).toBe('前置');
});


it.each(['provider', 'inline'] as const)('%s：空筛选保存后覆盖全部落地与后续新增节点，筛选可缩小范围', async output => {
  const env = setupApp(); envs.push(env); await addUser(env.store, 'alice');
  const user = client(env.app); await user.login('alice');
  const makeNode = (name: string) => ({ name, type: 'socks5', server: 'node.example.test', port: 1080 });
  const relay = (await user.post('/api/locals', { name: '前置集', proxies: [makeNode('香港前置'), makeNode('日本前置')] })).json.item;
  const landing = (await user.post('/api/locals', { name: '落地集', proxies: [makeNode('落地一'), makeNode('落地二')] })).json.item;
  const ref = (id: string) => ({ type: 'local', id });
  const via = { kind: 'node', ref: { nodeSet: ref(relay.id), match: { regex: '' }, fallback: 'error' } };
  const saved = await user.post('/api/profiles', { name: '全部节点验收', nodeSets: [relay, landing].map(local => ({ ref: ref(local.id), output })), chains: [{ id: 'all', landing: { nodeSet: ref(landing.id) }, via }], overlay: {}, refPolicy: { default: 'wrap' }, routing: { mode: 'independent', config: { groups: [], rules: [], final: { kind: 'builtin', name: 'DIRECT' } } } });
  expect(saved.status).toBe(201);
  const profile = (await user.get(`/api/profiles/${saved.json.item.id}`)).json.item;
  expect(profile.chains[0].via.ref.match).toEqual({ regex: '' });
  const preview = (body = profile) => user.post(`/api/profiles/${profile.id}/preview`, { profile: body, client: 'mihomo' });
  const all = await preview();
  expect(all.json.ok).toBe(true);
  expect(all.json.chainResolutions[0]).toMatchObject({ viaName: '香港前置', landingCount: 2, appliedCount: 2 });
  env.store.put('local', { ...landing, proxies: [...landing.proxies, makeNode('落地三')] }, env.store.getWithOwner('local', landing.id)!.owner);
  expect((await preview()).json.chainResolutions[0]).toMatchObject({ landingCount: 3, appliedCount: 3 });
  const filtered = await preview({ ...profile, chains: [{ ...profile.chains[0], landing: { nodeSet: ref(landing.id), filter: '二' }, via: { ...via, ref: { ...via.ref, match: { regex: '日本' } } } }] });
  expect(filtered.json.ok).toBe(true);
  expect(filtered.json.chainResolutions[0]).toMatchObject({ viaName: '日本前置', landingCount: 1, appliedCount: 1 });
  const invalid = await user.post('/api/profiles', { ...profile, id: undefined, chains: [{ ...profile.chains[0], via: { ...via, ref: { ...via.ref, match: { exact: '' } } } }] });
  expect(invalid.status).toBe(400);
});


it('节点预览在截断前筛选完整列表，支持空筛选、排除和非法正则反馈', async () => {
  const env = setupApp(); envs.push(env); const owner = await addUser(env.store, 'alice');
  const user = client(env.app); await user.login('alice');
  env.store.put('local', { id: 'many', name: '大节点集', proxies: Array.from({ length: 5002 }, (_, i) => ({ name: i < 5000 ? `节点-${i}` : i === 5000 ? 'HK-目标' : 'HK-备用', type: 'socks5', server: `node${i}.example.test`, port: 1080 })) }, owner.id);
  const all = await user.get('/api/nodesets/local/many/nodes');
  expect(all.json).toMatchObject({ total: 5002, truncated: true });
  expect(all.json.nodes).toHaveLength(5000);
  expect((await user.get('/api/nodesets/local/many/nodes?filter=')).json).toEqual(all.json);
  const selected = await user.get(`/api/nodesets/local/many/nodes?filter=${encodeURIComponent('(?i)^hk')}&excludeFilter=${encodeURIComponent('备用')}`);
  expect(selected.json).toMatchObject({ total: 1, unfilteredTotal: 5002, truncated: false });
  expect(selected.json.nodes.map((n: { name: string }) => n.name)).toEqual(['HK-目标']);
  expect((await user.get('/api/nodesets/local/many/nodes?filter=%5B')).status).toBe(400);
});
