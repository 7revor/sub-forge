import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ResourceService } from '../src/resources.ts';
import { addUser, client, setupApp } from './helpers.ts';
const active:ReturnType<typeof setupApp>[]=[];
afterEach(async()=>{for(const h of active.splice(0)){await h.snapshots.settled();h.store.close();}});
async function setup(){
  const calls:string[]=[];let failed=false;
  const h=setupApp({fetcher:async url=>{calls.push(url);if(failed && url.includes('rules'))throw new Error('模拟失败');return {status:200,body:url.includes('rules')?'DOMAIN,example.test':'proxies:\n  - {name: node, type: ss, server: example.test, port: 443, cipher: aes-128-gcm, password: test}'};}});active.push(h);
  const user=await addUser(h.store,'u');const api=client(h.app);await api.login('u');
  h.store.put('source',{id:'s',name:'节点',url:'https://node.test',pipeline:[]},user.id);
  h.store.put('collection',{id:'c',name:'组合',members:[{ref:{type:'source',id:'s'}},{ref:{type:'source',id:'s'}}],pipeline:[]},user.id);
  h.store.put('ruleset',{id:'r',name:'规则',sources:[{id:'a',kind:'remote',url:'https://rules.test',format:'auto'},{id:'off',kind:'remote',url:'https://disabled.test',format:'auto',enabled:false}]},user.id);
  h.store.put('profile',{id:'p',name:'订阅',nodeSets:[{ref:{type:'collection',id:'c'},output:'provider'}],chains:[],overlay:{extraRules:[{anchor:'top',rule:{id:'r',matcher:{kind:'ruleset',id:'r'},target:{kind:'builtin',name:'DIRECT'}}}]}},user.id);
  h.store.putToken({token:'t',profileId:'p'});
  return {...h,api,user,calls,fail:()=>{failed=true;}};
}
async function done(api:Awaited<ReturnType<typeof setup>>['api'],id:string){
  for(let i=0;i<100;i++){const result=await api.get(`/api/refresh-jobs/${id}`);if(result.json.job.state!=='running')return result.json.job;await new Promise(r=>setTimeout(r,5));}throw new Error('刷新任务没有结束');
}
describe('资源刷新任务',()=>{
  it('节点规则各自刷新，订阅递归去重并生成托管配置，部分失败保留旧内容',async()=>{
    const h=await setup();
    let started=await h.api.post('/api/sources/s/refresh-cache');expect(started.status).toBe(202);await done(h.api,started.json.job.id);expect(h.calls).toEqual(['https://node.test']);
    h.calls.length=0;started=await h.api.post('/api/rulesets/r/refresh-cache');await done(h.api,started.json.job.id);expect(h.calls).toEqual(['https://rules.test']);
    h.calls.length=0;h.fail();started=await h.api.post('/api/profiles/p/refresh-cache');const job=await done(h.api,started.json.job.id);
    expect(job.total).toBe(2);expect(job.completed).toBe(2);expect(job.results.filter((r:any)=>!r.ok)).toHaveLength(1);expect(job.render.ok).toBe(true);
    expect(h.calls.sort()).toEqual(['https://node.test','https://rules.test']);
    const sub=await h.app.request('/sub/t');const cfg=parse(await sub.text());
    expect(sub.headers.get('profile-update-interval')).toBe('24');
    for(const p of Object.values(cfg['rule-providers']) as any[])expect(p.url).toContain('https://sub.test/r/');
    for(const p of Object.values(cfg['proxy-providers']) as any[])expect(p.interval).toBe(86400);
  });
  it('后台调度不依赖请求，设置改变后按新周期刷新，任务及状态隔离',async()=>{
    const h=await setup();const service=new ResourceService(h.store,h.snapshots,h.renderer,()=>1700000000000);
    await service.tick();expect(h.calls).toHaveLength(2);await service.tick();expect(h.calls).toHaveLength(2);
    const other=await addUser(h.store,'other');const api=client(h.app);await api.login('other');
    expect((await api.post('/api/profiles/p/refresh-cache')).status).toBe(404);
    const start=await h.api.post('/api/profiles/p/refresh-cache');await done(h.api,start.json.job.id);
    expect((await api.get(`/api/refresh-jobs/${start.json.job.id}`)).status).toBe(404);
    await service.stop();
  });
});

it('MRS 校验成功后原样托管，损坏的新响应不会覆盖上次成功文件',async()=>{
  const {readFile}=await import('node:fs/promises');
  const {createUpstreamFetcher}=await import('../src/net/upstream.ts');
  const {parseAllowList}=await import('../src/net/ssrf.ts');
  const bytes=await readFile(new URL('./fixtures/meta-geosite/bilibili.mrs',import.meta.url));
  let bad=false;
  const fetcher=createUpstreamFetcher({allow:parseAllowList([]),fetchImpl:async()=>({status:200,headers:{get:()=>null},text:async()=>'',arrayBuffer:async()=>Uint8Array.from(bad?Buffer.from('invalid'):bytes).buffer})});
  const h=setupApp({fetcher});active.push(h);
  h.store.put('ruleset',{id:'r',name:'二进制',sources:[{id:'m',kind:'remote',format:'mrs',behavior:'domain',url:'https://mrs.test'}]});
  h.store.put('profile',{id:'p',name:'MRS',nodeSets:[],chains:[],overlay:{extraRules:[{anchor:'top',rule:{id:'r',matcher:{kind:'ruleset',id:'r'},target:{kind:'builtin',name:'DIRECT'}}}]}});
  h.store.putToken({token:'binary',profileId:'p'});
  const sub=await h.app.request('/sub/binary');expect(sub.status).toBe(200);
  const provider=Object.values(parse(await sub.text())['rule-providers'])[0] as {url:string;format:string};
  expect(provider.format).toBe('mrs');const url=new URL(provider.url);
  const res=await h.app.request(url.pathname+url.search);expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
  bad=true;const refreshed=await h.snapshots.refresh('ruleset','r','https://mrs.test',{format:'mrs'});expect(refreshed.ok).toBe(false);
  const fallback=await h.app.request(url.pathname+url.search);expect(Buffer.from(await fallback.arrayBuffer())).toEqual(bytes);
});
