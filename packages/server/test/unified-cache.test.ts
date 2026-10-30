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
  it('到期等待刷新，失败按统一周期延后且保留真实成功时间，手动刷新绕过周期', async () => {
    let body = 'DOMAIN,a.test', fail = false, calls = 0;
    const t = setupApp({fetcher:async () => { calls++; if (fail) throw new Error('模拟上游故障'); return {status:200,body}; }});
    const first = await t.snapshots.get('ruleset','r','https://r.test',{ttlSec:300});
    t.advance(301000);
    await t.snapshots.get('ruleset','r','https://r.test',{ttlSec:300});
    expect(calls).toBe(1);
    t.advance(86400000); fail = true;
    const failed = await t.snapshots.get('ruleset','r','https://r.test');
    expect(failed.snapshot?.fetchedAt).toBe(first.snapshot?.fetchedAt);
    expect(failed.error).toBe('模拟上游故障');
    t.advance(600000); await t.snapshots.get('ruleset','r','https://r.test'); expect(calls).toBe(2);
    fail = false; body = 'DOMAIN,b.test';
    const updated = await t.snapshots.get('ruleset','r','https://r.test',{}, {refresh:true});
    expect(updated.snapshot?.body).toBe(body);
    expect(t.store.countSnapshots('ruleset','r','https://r.test').ok).toBe(1);
    expect(t.snapshots.status('ruleset','r','https://r.test').error).toBeUndefined();
    t.store.close();
  });
  it('同权限同参数合并在途和成功内容，不跨用户，不复用已改变的读取参数', async () => {
    let calls = 0;
    const t = setupApp({fetcher:async () => { calls++; return {status:200,body:'DOMAIN,a.test'}; }});
    const a = await addUser(t.store,'a'), b = await addUser(t.store,'b');
    for (const [id,owner] of [['r1',a.id],['r2',a.id],['r3',b.id]]) t.store.put('ruleset',{id:id!,name:id!,sources:[]},owner!);
    await Promise.all(['r1','r2'].map(id=>t.snapshots.get('ruleset',id,'https://r.test')));
    expect(calls).toBe(1);
    await t.snapshots.get('ruleset','r3','https://r.test'); expect(calls).toBe(2);
    await t.snapshots.get('ruleset','r1','https://r.test',{ua:'other'}); expect(calls).toBe(3);
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
