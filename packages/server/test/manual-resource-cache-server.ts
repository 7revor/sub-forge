// 内置浏览器验收专用：内存数据库、虚构账号和上游，不读取生产数据。
import { serve } from '@hono/node-server';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/crypto.ts';
import { Store } from '../src/store.ts';
import { SnapshotService } from '../src/snapshots.ts';
import { RenderService } from '../src/render.ts';
import { ResourceService } from '../src/resources.ts';
import { RuleRepoService } from '../src/rule-repos/service.ts';
import type { RepoCache } from '../src/rule-repos/git-cache.ts';
const control=process.env.CACHE_TEST_CONTROL;
const store=new Store(':memory:');
const admin=store.createUser({username:'cache-admin',passwordHash:await hashPassword('cache-test-2026'),role:'admin'});
const user=store.createUser({username:'cache-user',passwordHash:await hashPassword('cache-test-2026'),role:'user'});
const upstream=async(url:string)=>{
  const state=control?JSON.parse(await readFile(control,'utf8')):{fail:false,version:1};
  await new Promise(r=>setTimeout(r,400));
  if(state.fail&&url.includes('rules'))throw new Error('验收模拟：规则上游暂时不可用');
  return {status:200,body:url.includes('nodes')?`trojan://fixture@node.example.test:443#节点${state.version}`:`DOMAIN,v${state.version}.example.test`};
};
const snapshots=new SnapshotService(store,upstream);
const publicUrl='http://127.0.0.1:18769';const renderer=new RenderService(store,snapshots,{publicUrl});
const cache:RepoCache={inspect:async()=>({defaultBranch:'main',branches:['main']}),sync:async repo=>Object.fromEntries(repo.refs.map(ref=>[ref,'a'.repeat(40)])),files:async()=>['rules/demo.list'],read:async()=> 'DOMAIN,fixture.example.test',remove:async()=>{},stop:async()=>{}};
const repos=new RuleRepoService(store,upstream,Date.now,cache,snapshots);
store.db.prepare('UPDATE rule_repos SET enabled = 0').run();
const repo=await repos.addCustom({name:'验收公开仓库',url:'https://github.com/fixture/rules',scans:[{ref:'main',directory:'rules',format:'auto',client:'any',groupBy:'path'}]});
await repos.refresh(repo);
for(const owner of [admin.id,user.id]){
  const prefix=owner===admin.id?'demo':'user';
  store.put('source',{id:`${prefix}-nodes`,name:'远程节点示例',url:'https://nodes.example.test/list',pipeline:[]},owner);
  store.put('ruleset',{id:`${prefix}-rules`,name:'远程规则示例',sources:[{id:'remote',kind:'remote',name:'规则来源',format:'auto',url:'https://rules.example.test/list'}]},owner);
  store.put('ruleset',{id:`${prefix}-local`,name:'纯本地规则',sources:[{id:'local',kind:'local',format:'auto',content:'DOMAIN,local.example.test'}]},owner);
  store.put('collection',{id:`${prefix}-collection`,name:'节点组合示例',members:[{ref:{type:'source',id:`${prefix}-nodes`}}],pipeline:[]},owner);
  store.put('profile',{id:`${prefix}-profile`,name:'统一缓存验收订阅',nodeSets:[{ref:{type:'collection',id:`${prefix}-collection`},output:'provider'}],refPolicy:{default:'wrap'},chains:[],overlay:{extraRules:[{anchor:'top',rule:{id:'r',matcher:{kind:'ruleset',id:`${prefix}-rules`},target:{kind:'builtin',name:'DIRECT'}}}]}},owner);
}
const resources=new ResourceService(store,snapshots,renderer);await resources.tick();
const app=createApp({store,snapshots,renderer,resources,ruleRepos:repos,publicUrl,webDir:resolve('../web/dist')});
const server=serve({fetch:app.fetch,hostname:'127.0.0.1',port:18769});
console.log(`隔离验收 ${publicUrl}，账号 cache-admin / cache-user，密码 cache-test-2026`);
let stopping=false;
async function stop(){
  if(stopping)return;stopping=true;store.closeEvents();
  const deadline=setTimeout(()=>{if('closeAllConnections' in server)server.closeAllConnections();},10_000);
  try {
    await new Promise<void>((done,reject)=>server.close(e=>e?reject(e):done()));
    await resources.stop();await repos.stop();await snapshots.settled();store.close();
  } finally {clearTimeout(deadline);}
}
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>void stop().catch(error=>{console.error(error);process.exitCode=1;}));
