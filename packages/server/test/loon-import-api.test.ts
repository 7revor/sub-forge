import { expect, it } from 'vitest';
import { loonFull } from '../../core/test/fixtures/loon-full.ts';
import { addUser, client, setupApp } from './helpers.ts';
it('完整导入预览不落库不联网，保存资源归当前用户，Loon 链实际进入订阅', async () => {
  let fetched = 0;
  const h = setupApp({ fetcher: async () => { fetched++; return { status: 200, body: '香港远程 = Shadowsocks,hk.example.test,443,aes-128-gcm,"example"' }; } });
  try {
    const alice = await addUser(h.store, 'alice'); await addUser(h.store, 'bob');
    const api = client(h.app), other = client(h.app); await api.login('alice'); await other.login('bob');
    const body = { name: 'Loon 完整导入', text: loonFull };
    const preview = await api.post('/api/profiles/import/loon', body);
    expect(preview.status, preview.text).toBe(200); expect(preview.json.plan.report.filter((r: any) => r.level === 'error')).toEqual([]);
    expect(preview.json.clients.mihomo.some((r: any) => r.code === 'proxy.block-quic-unsupported')).toBe(true);
    expect(preview.json.remoteChecked).toBe(false); expect(fetched).toBe(0); expect(h.store.list('profile')).toEqual([]);
    const saved = await api.post('/api/profiles/import/loon', { ...body, save: true });
    expect(saved.status, saved.text).toBe(201); expect(fetched).toBe(0);
    for (const kind of ['profile','source','collection','local'] as const) for (const doc of h.store.list(kind)) expect(h.store.getWithOwner(kind, doc.id)?.owner).toBe(alice.id);
    const id = saved.json.item.id; expect((await other.get('/api/profiles/' + id)).status).toBe(404);
    const token = h.store.listTokens(id)[0]!.token;
    const out = await h.app.request('/sub/' + token + '?target=loon');
    expect(out.status).toBe(200); expect(await out.text()).toContain('[Proxy Chain]'); expect(fetched).toBe(1);
    const incompatible = await h.renderer.render(id, { client: 'mihomo' }); expect(incompatible.ok).toBe(false);
  } finally { await h.snapshots.settled(); h.store.close(); }
});
it('导入失败整体回滚，未知段、链环与缺少最终出口不能绕过预览直接保存', async () => {
  const h = setupApp();
  try {
    await addUser(h.store, 'alice'); const api = client(h.app); await api.login('alice');
    for (const text of [loonFull + '\n[Script]\nscript=example', loonFull.replace('命名链 = 入口,落地', '命名链 = 科学上网,落地'), loonFull.replace('FINAL,科学上网', ''), loonFull.replace('https://subscription.example.test/list', 'https://'), loonFull.replace('[Remote Filter]', '额外来源 = https://?\n[Remote Filter]')]) {
      const result = await api.post('/api/profiles/import/loon', { name: '不能导入', text, save: true });
      expect(result.status, result.text).toBe(400);
      for (const kind of ['profile','source','local','collection'] as const) expect(h.store.list(kind)).toEqual([]);
      expect(h.store.db.prepare('SELECT count(*) AS n FROM sub_tokens').get()).toEqual({ n: 0 });
    }
    expect((await client(h.app).post('/api/profiles/import/loon', { name: '未登录', text: loonFull })).status).toBe(401);
  } finally { await h.snapshots.settled(); h.store.close(); }
});
it('远程规则导入只保存引用，预览说明内容尚未校验', async () => {
  const h=setupApp();
  try {
    await addUser(h.store,'remote');const api=client(h.app);await api.login('remote');
    const body={name:'远程规则',text:loonFull+'\n[Remote Rule]\nhttps://rules.example.test/list,policy=DIRECT,tag=测试,enabled=true'};
    const preview=await api.post('/api/profiles/import/loon',body);
    expect(preview.json.plan.report.filter((r:any)=>r.level==='error')).toEqual([]);
    expect(preview.json.clients.loon.some((r:any)=>r.code==='loon.import-remote-unchecked')).toBe(true);
    const saved=await api.post('/api/profiles/import/loon',{...body,save:true});expect(saved.status,saved.text).toBe(201);
  } finally {await h.snapshots.settled();h.store.close();}
});
