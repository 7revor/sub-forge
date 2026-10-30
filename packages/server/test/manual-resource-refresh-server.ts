// 内置浏览器验收：内存数据和可控虚构上游，仅监听回环地址。
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { ResourceService } from '../src/resources.ts';
import { addUser, setupApp } from './helpers.ts';

const pending=new Map<string,()=>void>();
let releaseAll=false;
let failing=false;
const env=setupApp({now:Date.now,fetcher:async url=>{
  if(!releaseAll)await new Promise<void>(resolve=>pending.set(url,resolve));
  if(failing && url.endsWith('/schwab.txt'))throw new Error('模拟远程规则服务暂时不可用，错误详情较长时仍保持单行状态，可悬停查看完整信息');
  return {status:200,body:'DOMAIN,example.test'};
}});
const user=await addUser(env.store,'refresh-admin','admin');
env.store.put('ruleset',{id:'finance',name:'Finance',sources:['stripe','wise','schwab','ibkr','paypal'].map(name=>({id:name,name:`v2fly-domain-list · ${name}.txt`,kind:'remote',url:`https://fixture.test/${name}.txt`,format:'auto'}))},user.id);
env.store.put('profile',{id:'finance-profile',name:'Finance 订阅',nodeSets:[],chains:[],refPolicy:{default:'wrap'},overlay:{extraRules:[{anchor:'top',rule:{id:'finance-rule',matcher:{kind:'ruleset',id:'finance'},target:{kind:'builtin',name:'DIRECT'}}}]}},user.id);
const resources=new ResourceService(env.store,env.snapshots,env.renderer);
const app=new Hono();
app.post('/__fixture/release/:file',c=>{
  const file=c.req.param('file');
  if(file==='all') {releaseAll=true;for(const release of pending.values())release();}
  else pending.get(`https://fixture.test/${file}.txt`)?.();
  return c.json({ok:true});
});
app.post('/__fixture/reset/:mode',c=>{
  pending.clear();releaseAll=false;failing=c.req.param('mode')==='failed';
  return c.json({ok:true});
});
app.route('/',createApp({...env,resources,publicUrl:'http://127.0.0.1:18893',webDir:fileURLToPath(new URL('../../web/dist',import.meta.url))}));
const server=serve({fetch:app.fetch,hostname:'127.0.0.1',port:18893});
console.log('隔离验收：http://127.0.0.1:18893；账号 refresh-admin，密码 password-123');
let stopping=false;
async function stop() {
  if(stopping)return;
  stopping=true;
  releaseAll=true;for(const release of pending.values())release();
  env.store.closeEvents();
  await resources.stop();
  await env.snapshots.settled();
  await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  env.store.close();
}
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{
  void stop().catch(error=>{console.error(error);process.exitCode=1;});
});
