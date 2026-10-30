import { describe, expect, it } from 'vitest';
import { addUser, client, setupApp } from './helpers.ts';

const docs = [
  ['sources', { url: 'https://example.test/sub', pipeline: [] }],
  ['collections', { members: [], pipeline: [] }],
  ['locals', { proxies: [] }],
  ['rulesets', { sources: [] }],
  ['profiles', { nodeSets: [] }],
  ['presets', { mihomo: {} }],
] as const;

async function setup() {
  const env = setupApp();
  await addUser(env.store, 'admin', 'admin');
  await addUser(env.store, 'other');
  const admin = client(env.app), other = client(env.app);
  await admin.login('admin');
  await other.login('other');
  return { ...env, admin, other };
}

describe('列表分页', () => {
  it('各类文档稳定分页、跨页搜索、空结果与越界回退，并保持用户隔离和全量兼容', async () => {
    const { store, admin, other } = await setup();
    try {
      for (const [segment, body] of docs) {
        for (const name of ['Alpha 甲', 'Beta 乙', '百分号 %_']) {
          const created = await admin.post(`/api/${segment}`, { ...body, name });
          expect(created.status, segment).toBe(201);
        }
        const path = `/api/${segment}`;
        const all = (await admin.get(path)).json;
        expect(all.items).toHaveLength(3);
        expect(all.total).toBeUndefined();
        const first = (await admin.get(`${path}?page=1&pageSize=2`)).json;
        const last = (await admin.get(`${path}?page=2&pageSize=2`)).json;
        expect(first).toMatchObject({ total: 3, page: 1, pageSize: 2, totalPages: 2 });
        expect([...first.items, ...last.items]).toEqual(all.items);
        expect((await admin.get(`${path}?page=999&pageSize=2`)).json).toEqual(last);
        const searched = (await admin.get(`${path}?q=${encodeURIComponent(' ALPHA ')}&pageSize=1&page=9`)).json;
        expect(searched).toMatchObject({ total: 1, page: 1, totalPages: 1 });
        expect(searched.items[0].name).toBe('Alpha 甲');
        expect((await admin.get(`${path}?q=%25_`)).json.items[0].name).toBe('百分号 %_');
        expect((await admin.get(`${path}?q=不存在&page=2`)).json).toMatchObject({ total: 0, page: 1, totalPages: 1, items: [] });
        expect((await other.get(`${path}?page=1`)).json.total).toBe((segment === 'presets' || segment === 'rulesets') ? 3 : 0);
        expect((await other.get(`${path}?q=Alpha`)).json.total).toBe((segment === 'presets' || segment === 'rulesets') ? 1 : 0);
        expect((await admin.del(`${path}/${last.items[0].id}`)).status).toBe(200);
        expect((await admin.get(`${path}?page=2&pageSize=2`)).json).toMatchObject({ total: 2, page: 1, totalPages: 1 });
      }
    } finally { store.close(); }
  });

  it('所有文档列表在完整集合中按名称包含匹配，忽略大小写后再分页', async () => {
    const { store, admin } = await setup();
    try {
      for (const [segment, body] of docs) {
        for (const name of [...Array.from({ length: 32 }, (_, index) => `ordinary-${index}`), 'prefix-TARGET-tail', 'Target-middle', '终点-target']) {
          expect((await admin.post(`/api/${segment}`, { ...body, name })).status).toBe(201);
        }
        const first = (await admin.get(`/api/${segment}?q=TaRgEt&pageSize=2`)).json;
        const second = (await admin.get(`/api/${segment}?q=target&pageSize=2&page=2`)).json;
        expect(first.total, segment).toBe(3); expect(second.total, segment).toBe(3);
        expect(new Set([...first.items, ...second.items].map(item => item.name)).size, segment).toBe(3);
        expect([...first.items, ...second.items].every(item => item.name.toLowerCase().includes('target')), segment).toBe(true);
      }
    } finally { store.close(); }
  });

  it('模板只分页当前内容，搜索不匹配旧名称，无名模板可按 ID 搜索', async () => {
    const { store, admin, other } = await setup();
    try {
      const base = { version: 1, groups: [], rules: [], final: { kind: 'builtin' as const, name: 'DIRECT' as const } };
      store.putTemplateVersion({ ...base, id: 'a', name: '旧名称' });
      store.putTemplateVersion({ ...base, id: 'a', version: 2, name: '最新 Alpha' });
      store.putTemplateVersion({ ...base, id: 'b', name: 'Beta' });
      store.putTemplateVersion({ ...base, id: 'legacy-id' });
      const first = (await other.get('/api/templates?pageSize=1')).json;
      expect(first).toMatchObject({ total: 3, page: 1, pageSize: 1, totalPages: 3, items: [{ id: 'a', name: '最新 Alpha' }] });
      expect((await admin.get('/api/templates?page=2&pageSize=1')).json.items[0].id).toBe('b');
      expect((await admin.get('/api/templates?q=旧名称')).json.total).toBe(0);
      expect((await admin.get('/api/templates?q=ALPHA')).json.items[0]).not.toHaveProperty('version');
      expect((await admin.get('/api/templates?q=legacy')).json.items[0].id).toBe('legacy-id');
      expect((await admin.get('/api/templates')).json.items).toHaveLength(3);
    } finally { store.close(); }
  });

  it('拒绝非法分页参数，缺省参数使用每页 20 条，空列表返回第 1 页', async () => {
    const { store, admin, app } = await setup();
    try {
      for (const path of ['/api/sources', '/api/templates']) {
        for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=abc', 'page=', 'page=9007199254740992', 'pageSize=0', 'pageSize=101', 'pageSize=1e2', 'pageSize=']) {
          expect((await admin.get(`${path}?${query}`)).status, query).toBe(400);
        }
        expect((await admin.get(`${path}?page=10`)).json).toEqual({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 });
        expect((await client(app).get(`${path}?page=1`)).status).toBe(401);
      }
    } finally { store.close(); }
  });
});
