import { parse } from 'yaml';
import { independentRouting } from './helpers.ts';
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
const draftProfile = () => ({ id: 'p', name: '订阅', nodeSets: [], chains: [], routing: independentRouting([profile().overlay.extraRules[0]!.rule]) });
it('未保存的远程规则草稿预览按 URL 共用上游内容，配置和用户都不进入缓存键', async () => {
  let calls = 0; const h = setup({ fetcher: async () => ({ status: 200, body: `DOMAIN,user${++calls}.test` }) });
  await addUser(h.store, 'a'); await addUser(h.store, 'b'); const a = client(h.app), b = client(h.app); await a.login('a'); await b.login('b');
  expect((await a.post('/api/profiles/preview', { profile: draftProfile() })).json.ok).toBe(true);
  expect((await b.post('/api/profiles/preview', { profile: draftProfile() })).json.ok).toBe(true); expect(calls).toBe(1);
});
it('隐式 MRS 格式采用相同拉取参数，文本不能伪装成 MRS', async () => {
  const { readFile } = await import('node:fs/promises'); const { createUpstreamFetcher } = await import('../src/net/upstream.ts'); const { parseAllowList } = await import('../src/net/ssrf.ts');
  let bytes = await readFile(new URL('./fixtures/meta-geosite/bilibili.mrs', import.meta.url));
  const fetcher = createUpstreamFetcher({ allow: parseAllowList([]), fetchImpl: async () => ({ status: 200, headers: { get: () => null }, text: async () => '', arrayBuffer: async () => Uint8Array.from(bytes).buffer }) });
  const h = setup({ fetcher }); h.store.put('ruleset', { id: 'r', name: 'MRS', sources: [{ id: 's', kind: 'remote', url: 'https://rules.test/a', format: 'mrs', behavior: 'domain' }] });
  const params = { format: 'mrs' as const, behavior: 'domain' as const };
  const first = await h.snapshots.getRuleContent('https://rules.test/a', params); expect(first.body).toMatch(/^#subforge-binary-mrs\n/);
  bytes = Buffer.from('# sub-forge: decoded-mrs-v1\nDOMAIN,forged.test');
  await expect(h.snapshots.refreshRuleContent('https://rules.test/a', params)).rejects.toThrow();
  expect((await h.snapshots.getRuleContent('https://rules.test/a', params)).body).toBe(first.body);
});
it('渲染校验期间更新配置，旧任务按新配置重试', async () => {
  const entered = gate(), held = gate(); let verified = 0;
  const h = setup({ fetcher: async () => ({ status: 200, body: 'DOMAIN,new.test' }) }); h.store.put('profile', profile());
  const renderer = new RenderService(h.store, h.snapshots, { verify: async () => { if (++verified === 1) { entered.release(); await held.promise; } return { ok: true, output: '' }; } });
  const old = renderer.render('p', { client: 'mihomo' }); await entered.promise;
  h.store.put('profile', { ...profile(), name: '新订阅' }); held.release();
  expect((await old).ok).toBe(true); expect(verified).toBe(2);
});
it('模板保存前必须校验二进制来源，不能跳过失败拉取', async () => {
  const h = setup({fetcher: async () => { throw new Error('模拟二进制上游失败'); }});
  const user = await addUser(h.store,'admin','admin'); const api = client(h.app); await api.login('admin');
  h.store.put('ruleset',{id:'binary',name:'二进制',sources:[{id:'s',kind:'remote',format:'mrs',behavior:'domain',url:'https://rules.test/a'}]},user.id);
  const result = await api.post('/api/templates',{name:'模板',groups:[],rules:[{id:'r',matcher:{kind:'ruleset',id:'binary'},target:{kind:'builtin',name:'DIRECT'}}],final:{kind:'builtin',name:'DIRECT'}});
  expect(result.status).toBe(400); expect(result.text).toContain('模拟二进制上游失败');
});
it('已保存组合的嵌套依赖不能跨用户读取或刷新', async () => {
  let calls=0; const h=setup({fetcher:async()=>{calls++;return {status:200,body:'trojan://test@node.test:443#secret'};}});
  const a=await addUser(h.store,'a'), b=await addUser(h.store,'b'); const api=client(h.app);await api.login('a');
  h.store.put('source',{id:'foreign',name:'其他用户节点',url:'https://node.test',pipeline:[]},b.id);
  // 模拟旧数据或引用权限变化；不能只在保存时检查权限。
  h.store.put('collection',{id:'collection',name:'组合',members:[{ref:{type:'source',id:'foreign'}}],pipeline:[]},a.id);
  expect((await api.get('/api/collections/cache?id=collection')).status).toBe(404);
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
  await expect(h.snapshots.getRuleContent('https://rules.test/a',{format:'mrs',behavior:'ipcidr'})).rejects.toThrow('behavior');
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
it('刷新任务合并重复点击，单项失败写入结果，关闭时等待在途读取结束', async () => {
  const {ResourceService}=await import('../src/resources.ts');const {vi}=await import('vitest');
  const h=setup();const service=new ResourceService(h.store,h.snapshots,h.renderer);const entered=gate(),held=gate();
  const spy=vi.spyOn(h.snapshots,'refreshRuleContent').mockImplementation(async url=>{
    if(url.includes('bad'))throw new Error('模拟任务错误');entered.release();await held.promise;throw new Error('模拟上游失败');
  });
  const list=['bad','slow'].map(id=>({kind:'ruleset' as const,name:id,url:`https://${id}.test`,params:{}}));
  const job=service.startJob('owner','repository-file','file',list);
  expect(service.startJob('owner','repository-file','file',list).id).toBe(job.id);
  await entered.promise;expect(service.getJob(job.id)?.state).toBe('running');
  let stopped=false;const stopping=service.stop().then(()=>{stopped=true;});await Promise.resolve();expect(stopped).toBe(false);
  held.release();await stopping;expect(service.getJob(job.id)?.state).toBe('interrupted');
  expect(service.getJob(job.id)?.results.map(r=>r.error)).toEqual(['模拟任务错误','模拟上游失败']);
  spy.mockRestore();
});
it('仓库正文跨周期立刻失效，读取失败报错不返回旧内容，也不进入系统资源列表', async () => {
  const {RuleRepoService}=await import('../src/rule-repos/service.ts');const {ResourceService}=await import('../src/resources.ts');
  let fail=false,calls=0;let now=new Date(2026,10,3,1).getTime();
  const fetcher=async()=>{calls++;if(fail)throw new Error('模拟文件失败');return {status:200,body:'DOMAIN,retained.test'};};
  const h=setup({fetcher,now:()=>now});
  const repo=new RuleRepoService(h.store,fetcher,()=>now,{inspect:async()=>({defaultBranch:'main',branches:['main']}),sync:async()=>({main:'a'.repeat(40)}),files:async()=>['rules/a.list'],read:async()=>'',remove:async()=>{},stop:async()=>{}},h.snapshots);
  h.store.db.prepare('UPDATE rule_repos SET enabled=0').run();
  const id=await repo.addCustom({name:'测试',url:'https://github.com/fixture/rules',scans:[{ref:'main',directory:'rules',format:'auto',client:'any',groupBy:'path'}]});await repo.refresh(id);
  await repo.filePreview(id,'main','rules/a.list');await repo.filePreview(id,'main','rules/a.list');expect(calls).toBe(1);
  const service=new ResourceService(h.store,h.snapshots,h.renderer,()=>now);
  expect(service.all()).toEqual([]);fail=true;now+=86400000;
  await expect(repo.filePreview(id,'main','rules/a.list')).rejects.toThrow('模拟文件失败');expect(calls).toBe(2);
  await service.stop();await repo.stop();
});
it('来源换地址或删除后回收自己的快照，不影响其他来源', async () => {
  const h=setup({fetcher:async()=>({status:200,body:'trojan://test@node.test:443#node'})});const user=await addUser(h.store,'u');
  for(const id of ['a','b'])h.store.put('source',{id,name:id,url:'https://old.test',pipeline:[]},user.id);
  await h.snapshots.getNodeSource({id:'a',url:'https://old.test'});await h.snapshots.getNodeSource({id:'b',url:'https://old.test'});
  h.store.put('source',{id:'a',name:'a',url:'https://new.test',pipeline:[]},user.id);
  expect(h.store.latestSnapshot('source','a','https://old.test')).toBeUndefined();
  expect(h.store.latestSnapshot('source','b','https://old.test')).toBeDefined();
  h.store.delete('source','b');expect(h.store.latestSnapshot('source','b','https://old.test')).toBeUndefined();
});
it('已删除来源的在途旧响应不会重新留下孤立缓存', async () => {
  const entered=gate(),held=gate();const h=setup({fetcher:async()=>{entered.release();await held.promise;return {status:200,body:'trojan://test@node.test:443#node'};}});
  h.store.put('source',{id:'s',name:'s',url:'https://old.test',pipeline:[]});
  const pending=h.snapshots.refreshNodeSource({id:'s',url:'https://old.test'});await entered.promise;h.store.delete('source','s');held.release();
  expect((await pending).ok).toBe(false);
  expect(h.store.latestSnapshot('source','s','https://old.test')).toBeUndefined();
});
it('等待刷新时撤销 token，专属规则入口也拒绝返回正文',async()=>{
  const entered=gate(),held=gate();let block=false;const h=setup({fetcher:async()=>{if(block){entered.release();await held.promise;}return {status:200,body:'DOMAIN,private.test'};}});
  h.store.put('profile',profile());issueProfileToken(h.store, {token:'token',profileId:'p'});const result=await h.renderer.render('p',{client:'mihomo'});if(!result.ok)throw new Error('准备失败');
  const key=new URL(Object.values<{url:string}>(parse(result.render.yaml)['rule-providers'])[0]!.url).searchParams.get('key')!;block=true;h.advance(86400001);
  const url=`/subs/ruleset?profile=p&token=token&key=${key}`;
  const pending=h.app.request(url);await entered.promise;h.store.deleteToken('token');held.release();expect((await pending).status).toBe(404);
});
