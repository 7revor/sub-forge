import { describe, expect, it } from 'vitest';
import { setupApp, addUser, client } from './helpers.ts';

describe('统一资源缓存', () => {
  it('设置仅管理员可修改，旧的来源 TTL 不再生效', async () => {
    const t = setupApp();
    await addUser(t.store,'admin','admin'); await addUser(t.store,'user');
    const a = client(t.app), u = client(t.app);
    await a.login('admin'); await u.login('user');
    expect((await u.put('/api/system',{resourceCacheTtlSec:3600})).status).toBe(403);
    expect((await a.put('/api/system',{resourceCacheTtlSec:60})).status).toBe(400);
    expect((await a.put('/api/system',{resourceCacheTtlSec:3600})).status).toBe(200);
    expect(t.store.resourceCacheTtlSec).toBe(3600);
    t.store.close();
  });
  it('相同 URL 和参数跨用户共用一份内容，读取参数不同各存一份', async () => {
    let calls = 0;
    const t = setupApp({fetcher:async () => { calls++; return {status:200,body:'DOMAIN,a.test'}; }});
    await Promise.all([t.snapshots.getRuleContent('https://r.test'), t.snapshots.getRuleContent('https://r.test')]);
    expect(calls).toBe(1);
    await t.snapshots.getRuleContent('https://r.test'); expect(calls).toBe(1);
    await t.snapshots.getRuleContent('https://r.test',{ua:'other'}); expect(calls).toBe(2);
    await t.snapshots.getRuleContent('https://r.test',{ttlSec:300}); expect(calls).toBe(2);
    t.store.close();
  });
});

it('关闭服务时终止事件等待；旧缓存设置在保存时移除', async () => {
  const t = setupApp();
  const admin = await addUser(t.store, 'admin', 'admin');
  const api = client(t.app); const login = await api.login('admin');
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  const response = await t.app.request('/api/events', { headers: { cookie } });
  const reader = response.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: changed');
  t.store.closeEvents();
  expect((await reader.read()).done).toBe(true);
  expect(t.store.listeners.size).toBe(0);
  t.store.put('source', { id:'old',name:'旧来源',url:'https://old.test',pipeline:[],fetch:{ttlSec:300} }, admin.id);
  expect(t.store.get('source','old')?.fetch).toBeUndefined();
  t.store.close();
});
