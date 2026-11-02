import { afterEach, describe, expect, it, vi } from 'vitest';
import { addUser, client, setupApp } from './helpers.ts';

afterEach(() => { vi.useRealTimers(); });

describe('代码审查回归', () => {
  it('事件流保活不发 changed，真实变化才发', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = setupApp();
    await addUser(t.store, 'admin', 'admin');
    const login = await client(t.app).login('admin');
    const response = await t.app.request('/api/events', { headers: { cookie: login.headers.get('set-cookie')!.split(';')[0]! } });
    const reader = response.body!.getReader();
    const next = async () => new TextDecoder().decode((await reader.read()).value);
    expect(await next()).toContain('event: changed');
    const keepAlive = next();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await keepAlive).toBe(': keep-alive\n\n');
    const changed = next();
    t.store.changed();
    expect(await changed).toContain('event: changed');
    t.store.close();
  });

  it('模板跟随数覆盖全部用户，仅管理员可读', async () => {
    const t = setupApp();
    await addUser(t.store, 'admin', 'admin');
    await addUser(t.store, 'alice');
    const admin = client(t.app), alice = client(t.app);
    await admin.login('admin'); await alice.login('alice');
    const body = { name: '模板', groups: [{ id: 'g', name: '组', type: 'select', members: [{ kind: 'builtin', name: 'DIRECT' }] }], rules: [], final: { kind: 'group', groupId: 'g' } };
    const template = (await admin.post('/api/templates', body)).json.item;
    expect((await admin.get('/api/templates/usage')).json.items).toEqual([]);
    expect((await alice.post('/api/profiles', { name: '订阅', nodeSets: [], routing: { mode: 'bound', templateId: template.id, groupAdditions: {} } })).status).toBe(201);
    expect((await admin.get('/api/templates/usage')).json.items).toEqual([{ id: template.id, followers: 1 }]);
    expect((await alice.get('/api/templates/usage')).status).toBe(403);
    t.store.close();
  });

  it('导入种子保留现有订阅的兜底配置', () => {
    const t = setupApp();
    t.store.putLastGood('existing', 'mihomo:any', { yaml: 'a: 1' });
    t.store.importSeed({ sources: [{ id: 's', name: '种子来源', url: 'https://seed.test', pipeline: [] }] });
    expect(t.store.getLastGood('existing', 'mihomo:any')?.data).toEqual({ yaml: 'a: 1' });
    expect(t.store.get('source', 's')?.name).toBe('种子来源');
    t.store.close();
  });

  it('管理员修改他人规则集时，已保存的仓库关联受同样保护', async () => {
    const t = setupApp();
    await addUser(t.store, 'admin', 'admin');
    const owner = await addUser(t.store, 'alice');
    const admin = client(t.app);
    await admin.login('admin');
    const source = { id: 'linked', kind: 'remote' as const, url: 'https://rules.test/a.list', format: 'auto' as const, repository: { repo: 'removed', entry: 'a', ref: 'main', path: 'a.list' } };
    t.store.put('ruleset', { id: 'r', name: '原名', sources: [source] }, owner.id);
    expect((await admin.put('/api/rulesets/r', { name: '新名', sources: [source] })).status).toBe(200);
    const moved = await admin.put('/api/rulesets/r', { name: '新名', sources: [{ ...source, url: 'https://rules.test/b.list' }] });
    expect(moved.status).toBe(400);
    expect(moved.json.error).toMatch(/不可修改/);
    t.store.close();
  });

  it('创建用户一次写入脚本权限，类型错误时不创建', async () => {
    const t = setupApp();
    await addUser(t.store, 'admin', 'admin');
    const admin = client(t.app);
    await admin.login('admin');
    const created = await admin.post('/api/users', { username: 'scripter', password: 'password-123', scriptAllowed: true });
    expect(created.json.user.scriptAllowed).toBe(true);
    expect((await admin.post('/api/users', { username: 'plain', password: 'password-123' })).json.user.scriptAllowed).toBe(false);
    expect((await admin.post('/api/users', { username: 'bad-type', password: 'password-123', scriptAllowed: 'yes' })).status).toBe(400);
    expect(t.store.getUserAuth('bad-type')).toBeUndefined();
    t.store.close();
  });
});
