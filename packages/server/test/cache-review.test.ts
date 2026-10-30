import { ruleBodies } from './helpers.ts';
import { issueProfileToken } from './helpers.ts';
import { afterEach, expect, it } from 'vitest';
import { remoteRuleMatcher } from '@sub-forge/core';
import { RenderService } from '../src/render.ts';
import { addUser, client, setupApp } from './helpers.ts';
const active: ReturnType<typeof setupApp>[] = [];
afterEach(async () => { for (const h of active.splice(0)) { await h.snapshots.settled(); h.store.close(); } });
function setup(options: Parameters<typeof setupApp>[0] = {}) { const h = setupApp(options); active.push(h); return h; }
function gate() { let release!: () => void; const promise = new Promise<void>(r => { release = r; }); return { promise, release }; }
const profile = (id = 'p') => ({ id, name: '订阅', nodeSets: [], chains: [], refPolicy: { default: 'wrap' as const }, overlay: { extraRules: [{ anchor: 'top' as const, rule: { id: 'r', matcher: remoteRuleMatcher('https://rules.test/a'), target: { kind: 'builtin' as const, name: 'DIRECT' as const } } }] } });
it('公共远程规则原文跨用户共享，同用户再次预览复用', async () => {
  let calls = 0; const h = setup({ fetcher: async () => ({ status: 200, body: `DOMAIN,user${++calls}.test` }) });
  await addUser(h.store, 'a'); await addUser(h.store, 'b'); const a = client(h.app), b = client(h.app); await a.login('a'); await b.login('b');
  expect((await a.post('/api/profiles/preview', { profile: profile() })).json.ok).toBe(true);
  expect((await b.post('/api/profiles/preview', { profile: profile() })).json.ok).toBe(true); expect(calls).toBe(1);
  await a.post('/api/profiles/preview', { profile: profile() }); expect(calls).toBe(1);
});
it('隐式 MRS 格式采用相同拉取参数，文本不能伪装成 MRS', async () => {
  const { readFile } = await import('node:fs/promises'); const { createUpstreamFetcher } = await import('../src/net/upstream.ts'); const { parseAllowList } = await import('../src/net/ssrf.ts');
  let bytes = await readFile(new URL('./fixtures/meta-geosite/bilibili.mrs', import.meta.url));
  const fetcher = createUpstreamFetcher({ allow: parseAllowList([]), fetchImpl: async () => ({ status: 200, headers: { get: () => null }, text: async () => '', arrayBuffer: async () => Uint8Array.from(bytes).buffer }) });
  const h = setup({ fetcher }); h.store.put('ruleset', { id: 'r', name: 'MRS', sources: [{ id: 's', kind: 'remote', url: 'https://rules.test/a', format: 'mrs', behavior: 'domain' }] });
  const first = await h.snapshots.get('ruleset', 'r', 'https://rules.test/a'); expect(first.snapshot?.body).toMatch(/^#subforge-binary-mrs\n/);
  bytes = Buffer.from('# sub-forge: decoded-mrs-v1\nDOMAIN,forged.test');
  const result = await h.snapshots.get('ruleset', 'r', 'https://rules.test/a', { format: 'mrs' }, { refresh: true });
  expect(result.error).toBeDefined(); expect(result.snapshot?.body).toBe(first.snapshot?.body);
});
it('渲染校验期间更新配置与快照，旧任务不能覆盖新结果', async () => {
  let body = 'DOMAIN,old.test'; const entered = gate(), held = gate(); let verified = 0;
  const h = setup({ fetcher: async () => ({ status: 200, body }) }); h.store.put('profile', profile());
  const renderer = new RenderService(h.store, h.snapshots, { publicUrl: 'https://sub.test', verify: async () => { if (++verified === 1) { entered.release(); await held.promise; } return { ok: true, output: '' }; } });
  const old = renderer.render('p', { client: 'mihomo' }); await entered.promise;
  body = 'DOMAIN,new.test'; h.store.put('profile', { ...profile(), name: '新订阅' });
  await h.snapshots.refresh('ruleset', profile().overlay.extraRules[0]!.rule.matcher.id, 'https://rules.test/a');
  await renderer.render('p', { client: 'mihomo' }); held.release(); await old;
  const saved = h.store.getLastGood<import('../src/render.ts').StoredRender>('p', 'mihomo:any')!;
  expect(Object.values(ruleBodies(h.store, saved.data)).join('')).toContain('new.test');
});
it('渲染等待中删除订阅，不得重新写成功配置', async () => {
  const entered = gate(), held = gate(); const h = setup({ fetcher: async () => { entered.release(); await held.promise; return { status: 200, body: 'DOMAIN,a.test' }; } });
  h.store.put('profile', profile()); const pending = h.renderer.render('p', { client: 'mihomo' });
  await entered.promise; h.store.delete('profile', 'p'); held.release(); expect((await pending).ok).toBe(false); expect(h.store.getLastGood('p', 'mihomo:any')).toBeUndefined();
});
it('等待刷新时撤销 token，完成后不得下发内容', async () => {
  const entered = gate(), held = gate(); const h = setup({ fetcher: async () => { entered.release(); await held.promise; return { status: 200, body: 'DOMAIN,secret.test' }; } });
  h.store.put('profile', profile()); issueProfileToken(h.store, { token: 'old-token', profileId: 'p' });
  const pending = h.app.request('/sub/old-token/p'); await entered.promise; h.store.deleteToken('old-token'); held.release(); expect((await pending).status).toBe(404);
});
it('旧快照首次绑定不得被不同 UA 的草稿冒用', async () => {
  let calls = 0; const h = setup({ fetcher: async () => { calls++; return { status: 200, body: 'DOMAIN,new.test' }; } });
  h.store.put('ruleset', { id: 'legacy', name: '旧规则', sources: [{ id:'s', kind:'remote', format:'auto', url:'https://rules.test/a', fetch:{ua:'original'} }] });
  h.store.addSnapshot({ ownerKind:'ruleset', ownerId:'legacy', url:'https://rules.test/a', fetchedAt:1700000000000, ok:true, body:'DOMAIN,old.test', hash:'old' });
  const result = await h.snapshots.get('ruleset','legacy','https://rules.test/a',{ua:'changed'});
  expect(calls).toBe(1); expect(result.snapshot?.body).toBe('DOMAIN,new.test');
});
it('模板保存前必须校验二进制来源，不能跳过失败拉取', async () => {
  const h = setup({fetcher: async () => { throw new Error('模拟二进制上游失败'); }});
  const user = await addUser(h.store,'admin','admin'); const api = client(h.app); await api.login('admin');
  h.store.put('ruleset',{id:'binary',name:'二进制',sources:[{id:'s',kind:'remote',format:'mrs',behavior:'domain',url:'https://rules.test/a'}]},user.id);
  const result = await api.post('/api/templates',{name:'模板',groups:[],rules:[{id:'r',matcher:{kind:'ruleset',id:'binary'},target:{kind:'builtin',name:'DIRECT'}}],final:{kind:'builtin',name:'DIRECT'}});
  expect(result.status).toBe(400); expect(result.text).toContain('模拟二进制上游失败');
});
it('只刷新快照时，延迟完成的旧校验也不能回写旧原文', async () => {
  let body = 'DOMAIN,old.test'; const entered = gate(), held = gate(); let calls = 0;
  const h = setup({ fetcher: async () => ({status:200,body}) }); h.store.put('profile',profile());
  const renderer = new RenderService(h.store,h.snapshots,{publicUrl:'https://sub.test',verify:async()=>{if(++calls===1){entered.release();await held.promise;}return {ok:true,output:''};}});
  const pending = renderer.render('p',{client:'mihomo'}); await entered.promise;
  body='DOMAIN,new.test'; await h.snapshots.refresh('ruleset',profile().overlay.extraRules[0]!.rule.matcher.id,'https://rules.test/a');
  held.release(); const result=await pending;
  expect(result.ok && Object.values(ruleBodies(h.store, result.render)).join('')).toContain('new.test');
});
it('已保存组合的嵌套依赖不能跨用户读取或刷新', async () => {
  let calls=0; const h=setup({fetcher:async()=>{calls++;return {status:200,body:'trojan://test@node.test:443#secret'};}});
  const a=await addUser(h.store,'a'), b=await addUser(h.store,'b'); const api=client(h.app);await api.login('a');
  h.store.put('source',{id:'foreign',name:'其他用户节点',url:'https://node.test',pipeline:[]},b.id);
  // 模拟旧数据或引用权限变化；不能只在保存时检查权限。
  h.store.put('collection',{id:'collection',name:'组合',members:[{ref:{type:'source',id:'foreign'}}],pipeline:[]},a.id);
  expect((await api.get('/api/collections/collection/cache')).status).toBe(404);
  expect((await api.post('/api/collections/collection/refresh-cache')).status).toBe(404);
  expect(calls).toBe(0);
});
it('公共规则作者角色变化不影响全站读取', async () => {
  const h=setup({fetcher:async()=>({status:200,body:'DOMAIN,secret.test'})}); const admin=await addUser(h.store,'admin','admin'), user=await addUser(h.store,'user');
  const api=client(h.app);await api.login('user');
  h.store.put('ruleset',{id:'shared',name:'公共规则',sources:[{id:'s',kind:'remote',format:'auto',url:'https://rules.test/a'}]},admin.id);
  h.store.put('profile',{...profile(),overlay:{extraRules:[{anchor:'top',rule:{id:'r',matcher:{kind:'ruleset',id:'shared'},target:{kind:'builtin',name:'DIRECT'}}}]}},user.id);
  expect((await h.renderer.render('p',{client:'mihomo'})).ok).toBe(true);
  h.store.updateUser(admin.id,{role:'user'});
  expect((await api.post('/api/profiles/p/refresh-cache')).status).toBe(202);
  expect(await h.renderer.render('p',{client:'mihomo'})).toMatchObject({ok:true});
});
it('MRS 内容类型与声明不符时拒绝更新', async () => {
  const {readFile}=await import('node:fs/promises');const {createUpstreamFetcher}=await import('../src/net/upstream.ts');const {parseAllowList}=await import('../src/net/ssrf.ts');
  const bytes=await readFile(new URL('./fixtures/meta-geosite/bilibili.mrs',import.meta.url));
  const h=setup({fetcher:createUpstreamFetcher({allow:parseAllowList([]),fetchImpl:async()=>({status:200,headers:{get:()=>null},text:async()=>'',arrayBuffer:async()=>Uint8Array.from(bytes).buffer})})});
  const result=await h.snapshots.get('ruleset','r','https://rules.test/a',{format:'mrs',behavior:'ipcidr'});
  expect(result.snapshot).toBeUndefined();expect(result.error).toContain('behavior');
});
it('写出 SSE 首条消息期间的变更不会丢失', async () => {
  const h=setup();await addUser(h.store,'u');const api=client(h.app);const login=await api.login('u');
  const response=await h.app.request('/api/events',{headers:{cookie:login.headers.get('set-cookie')!.split(';')[0]!}});
  const reader=response.body!.getReader();h.store.changed();
  await reader.read();
  const next=reader.read();const timeout=setTimeout(()=>h.store.closeEvents(),500);
  try {const result=await next;expect(result.done).toBe(false);expect(new TextDecoder().decode(result.value)).toContain('event: changed');}
  finally {clearTimeout(timeout);h.store.closeEvents();await reader.cancel();}
});
it('刷新任务合并重复点击，工作线程失败时等待其他线程结束再完成', async () => {
  const {ResourceService}=await import('../src/resources.ts');const {vi}=await import('vitest');
  const h=setup();const service=new ResourceService(h.store,h.snapshots,h.renderer);const entered=gate(),held=gate();
  const spy=vi.spyOn(h.snapshots,'refresh').mockImplementation(async(kind,id,url)=>{
    if(id==='bad')throw new Error('模拟任务错误');entered.release();await held.promise;
    return h.store.addSnapshot({ownerKind:kind,ownerId:id,url,fetchedAt:1,ok:false,error:'模拟上游失败'});
  });
  const list=['bad','slow'].map(id=>({kind:'ruleset' as const,id,name:id,url:`https://${id}.test`,options:{}}));
  const job=service.startJob('owner','repository-file','file',list);
  expect(service.startJob('owner','repository-file','file',list).id).toBe(job.id);
  await entered.promise;expect(service.getJob(job.id)?.state).toBe('running');
  let stopped=false;const stopping=service.stop().then(()=>{stopped=true;});await Promise.resolve();expect(stopped).toBe(false);
  held.release();await stopping;expect(service.getJob(job.id)?.state).toBe('interrupted');expect(service.getJob(job.id)?.completed).toBe(1);
  spy.mockRestore();
});
it('已浏览但未引用的仓库正文也参与调度，失败可见且保留旧内容', async () => {
  const {RuleRepoService}=await import('../src/rule-repos/service.ts');const {ResourceService}=await import('../src/resources.ts');
  let fail=false,calls=0;let now=1700000000000;
  const fetcher=async()=>{calls++;if(fail)throw new Error('模拟文件失败');return {status:200,body:'DOMAIN,retained.test'};};
  const h=setup({fetcher,now:()=>now});
  const repo=new RuleRepoService(h.store,fetcher,()=>now,{inspect:async()=>({defaultBranch:'main',branches:['main']}),sync:async()=>({main:'a'.repeat(40)}),files:async()=>['rules/a.list'],read:async()=>'',remove:async()=>{},stop:async()=>{}},h.snapshots);
  h.store.db.prepare('UPDATE rule_repos SET enabled=0').run();
  const id=await repo.addCustom({name:'测试',url:'https://github.com/fixture/rules',scans:[{ref:'main',directory:'rules',format:'auto',client:'any',groupBy:'path'}]});await repo.refresh(id);
  const first=await repo.filePreview(id,'main','rules/a.list');expect(calls).toBe(1);
  const service=new ResourceService(h.store,h.snapshots,h.renderer,()=>now);service.setAdditionalResources(()=>repo.cachedResources());
  expect(service.all()).toHaveLength(1);fail=true;now+=86400001;await service.tick();expect(calls).toBe(2);
  const stale=await repo.filePreview(id,'main','rules/a.list');expect(stale.content).toBe(first.content);expect(stale.cache?.error).toBe('模拟文件失败');expect(stale.cache?.lastSuccessAt).toBe(first.cache?.lastSuccessAt);
  expect(service.statuses(service.all())[0]?.error).toBe('模拟文件失败');await service.stop();await repo.stop();
});
it('来源换地址或删除后回收旧原文，但不误删其他来源共享的缓存', async () => {
  const h=setup({fetcher:async()=>({status:200,body:'trojan://test@node.test:443#node'})});const user=await addUser(h.store,'u');
  for(const id of ['a','b'])h.store.put('source',{id,name:id,url:'https://old.test',pipeline:[]},user.id);
  const first=await h.snapshots.get('source','a','https://old.test');await h.snapshots.get('source','b','https://old.test');
  h.store.put('source',{id:'a',name:'a',url:'https://new.test',pipeline:[]},user.id);
  expect(h.store.latestSnapshot('source',first.snapshot!.ownerId,'https://old.test')).toBeDefined();
  h.store.delete('source','b');expect(h.store.latestSnapshot('source',first.snapshot!.ownerId,'https://old.test')).toBeUndefined();
});
it('已删除来源的在途旧响应不会重新留下孤立缓存', async () => {
  const entered=gate(),held=gate();const h=setup({fetcher:async()=>{entered.release();await held.promise;return {status:200,body:'trojan://test@node.test:443#node'};}});
  h.store.put('source',{id:'s',name:'s',url:'https://old.test',pipeline:[]});const resource=h.snapshots.identity('source','s','https://old.test');
  const pending=h.snapshots.refresh('source','s','https://old.test');await entered.promise;h.store.delete('source','s');held.release();await pending;
  expect(h.store.latestSnapshot('source',resource,'https://old.test')).toBeUndefined();
});
it.each(['provider'])('等待刷新时撤销 token，%s 入口也拒绝已保留的旧版本',async route=>{
  const entered=gate(),held=gate();let block=false;const h=setup({fetcher:async()=>{if(block){entered.release();await held.promise;}return {status:200,body:'DOMAIN,private.test'};}});
  h.store.put('profile',profile());issueProfileToken(h.store, {token:'token',profileId:'p'});const result=await h.renderer.render('p',{client:'mihomo'});if(!result.ok)throw new Error('准备失败');
  const key=result.render.ruleResources[0]!;const version=result.render.generation!;block=true;h.advance(86400001);
  const url=route==='provider'?`/r/token/${key}?v=${version}`:`/api/rules/convert?${new URLSearchParams({url:'https://rules.test/a',token:'token',key,v:version})}`;
  const pending=h.app.request(url);await entered.promise;h.store.deleteToken('token');held.release();expect((await pending).status).toBe(404);
});
it('校验期间新发生的拉取失败不会丢失告警，仍使用最后成功内容', async () => {
  let fail=false;const entered=gate(),held=gate();let verified=0;
  const h=setup({fetcher:async()=>{if(fail)throw new Error('最新失败');return {status:200,body:'DOMAIN,retained.test'};}});h.store.put('profile',profile());
  const renderer=new RenderService(h.store,h.snapshots,{publicUrl:'https://sub.test',verify:async()=>{if(++verified===1){entered.release();await held.promise;}return {ok:true,output:''};}});
  const pending=renderer.render('p',{client:'mihomo'});await entered.promise;fail=true;
  await h.snapshots.refresh('ruleset',profile().overlay.extraRules[0]!.rule.matcher.id,'https://rules.test/a');held.release();
  const result=await pending;expect(result.ok).toBe(true);expect(result.report).toContainEqual(expect.objectContaining({code:'ruleset.fetch-failed',level:'warn'}));
  expect(result.ok&&Object.values(ruleBodies(h.store, result.render)).join('')).toContain('retained.test');
});
