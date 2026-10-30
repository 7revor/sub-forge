import { afterEach, expect, it } from 'vitest';
import { addUser, client, setupApp } from './helpers.ts';
const envs: ReturnType<typeof setupApp>[] = [];
afterEach(async () => { for (const e of envs.splice(0)) { await e.snapshots.settled(); e.store.close(); } });
it('移出落地节点集时拒绝残留代理链，来源与对应链同时移出后保存成功', async () => {
  const env = setupApp(); envs.push(env);
  await addUser(env.store, 'alice'); const user = client(env.app); await user.login('alice');
  const local = (await user.post('/api/locals', { name: '落地', proxies: [{ name: '节点 A', type: 'socks5', server: 'example.test', port: 1080 }] })).json.item;
  const ref = { type: 'local', id: local.id };
  const profile = (await user.post('/api/profiles', { name: '移出验收', nodeSets: [{ ref, output: 'provider' }], overlay: {}, chains: [{ id: 'c', landing: { nodeSet: ref }, via: { kind: 'group', groupId: 'g' } }], refPolicy: { default: 'wrap' }, routing: { mode: 'independent', config: { groups: [{ id: 'g', name: '前置', type: 'select', members: [{ kind: 'builtin', name: 'DIRECT' }] }], rules: [], final: { kind: 'group', groupId: 'g' } } } })).json.item;
  const invalid = await user.put(`/api/profiles/${profile.id}`, { ...profile, nodeSets: [] });
  expect(invalid.status).toBe(400);
  expect(JSON.stringify(invalid.json)).toContain('落地');
  expect((await user.get(`/api/profiles?id=${profile.id}`)).json.item.chains).toHaveLength(1);
  const valid = await user.put(`/api/profiles/${profile.id}`, { ...profile, nodeSets: [], chains: [] });
  expect(valid.status).toBe(200); expect(valid.json.item.chains).toEqual([]);
  expect((await user.get(`/api/locals?id=${local.id}`)).status).toBe(200);
});
