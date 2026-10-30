import { ResourceAccessError } from './resource-access.ts';
// 资源调度与手动刷新使用同一依赖收集和状态。任务持久化，重启后明确标记中断。
import type { NodeSetID } from '@sub-forge/core';
import { profileTemplate } from './profile-routing.ts';
import type { ProfileDoc, RuleSetDoc } from './docs.ts';
import { randomId } from './crypto.ts';
import type { RenderService } from './render.ts';
import type { SnapshotFetchOptions, SnapshotService } from './snapshots.ts';
import type { SnapshotOwner, Store } from './store.ts';

export type Resource = { kind:SnapshotOwner; id:string; name:string; url:string; options:SnapshotFetchOptions };
// 旧任务仅含已完成结果，没有 state；新任务从创建起保留完整、有序的资源列表。
export type RefreshResult = { name:string; state?:'pending'|'running'|'done'|'interrupted'; ok?:boolean; available:boolean; error?:string };
export type RefreshJob = { id:string; owner:string; kind:string; documentId:string; state:'running'|'done'|'interrupted'; total:number; completed:number; results:RefreshResult[]; render?:{ok:boolean;error?:string}; error?:string };
export class ResourceService {
  private readonly running = new Map<string, Promise<void>>();
  private timer?: ReturnType<typeof setInterval>;
  private stopping = false;
  private additionalResources: () => Resource[] = () => [];
  setAdditionalResources(read: () => Resource[]) { this.additionalResources = read; }
  private ticking?: Promise<void>;
  constructor(private store:Store,private snapshots:SnapshotService,private renderer:RenderService,private now:()=>number=Date.now) {
    store.db.exec('CREATE TABLE IF NOT EXISTS refresh_jobs (id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL, at INTEGER NOT NULL)');
    for (const row of store.db.prepare('SELECT data FROM refresh_jobs').all() as {data:string}[]) {
      const job = JSON.parse(store.cipher.decrypt(row.data)) as RefreshJob;
      if (job.state === 'running') { job.state = 'interrupted';job.error = '服务重启，刷新任务已中断，请重新刷新';this.interruptPending(job);this.save(job); }
    }
  }
  private interruptPending(job:RefreshJob) {
    for (const result of job.results) {
      if (result.ok === undefined) result.state = 'interrupted';
    }
  }
  private save(job:RefreshJob) {
    this.store.db.prepare('INSERT OR REPLACE INTO refresh_jobs VALUES (?,?,?,?)').run(job.id,job.owner,this.store.cipher.encrypt(JSON.stringify(job)),this.now());
    this.store.changed();
  }
  getJob(id:string):RefreshJob|undefined {
    const row = this.store.db.prepare('SELECT data FROM refresh_jobs WHERE id = ?').get(id) as {data:string}|undefined;
    return row ? JSON.parse(this.store.cipher.decrypt(row.data)) : undefined;
  }
  ruleResources(rs:RuleSetDoc,scope?:string):Resource[] {
    return rs.sources.filter(s=>s.enabled !== false && s.kind === 'remote' && s.url).map(s=>({kind:'ruleset',id:rs.id,name:`${rs.name} / ${s.name || s.id}`,url:s.url!,options:{...s.fetch,format:s.format,behavior:s.behavior,scope:s.repository && !s.fetch?.ua ? 'public-repository' : this.store.getWithOwner('ruleset',rs.id)?.owner ?? scope}}));
  }
  nodeResources(refs:NodeSetID[], owner?:string|null):Resource[] {
    return this.renderer.collectNodeSets(refs,owner).sources.map(s=>({kind:'source',id:s.id,name:s.name,url:s.url,options:{}}));
  }
  collect(kind:string,id:string):Resource[] {
    if (kind === 'source' || kind === 'collection') return this.nodeResources([{type:kind,id}]);
    if (kind === 'ruleset') { const rs = this.store.get('ruleset',id); return rs ? this.ruleResources(rs) : []; }
    if (kind !== 'profile') throw new Error('不支持的刷新对象');
    const profile = this.store.get('profile',id);
    if (!profile) throw new Error('配置订阅不存在');
    const template = profile.routing?.mode === 'independent' ? undefined : profileTemplate(profile,(key,v)=>this.store.getTemplate(key,v));
    return [...this.nodeResources(profile.nodeSets.map(n=>n.ref),this.store.getWithOwner('profile',id)?.owner),...Object.values(this.renderer.collectRules(profile,template).rulesets).flatMap(rs=>this.ruleResources(rs as RuleSetDoc,this.store.getWithOwner('profile',id)?.owner ?? undefined))];
  }
  unique(resources:Resource[]):Resource[] {
    return [...new Map(resources.map(r=>[this.snapshots.identity(r.kind,r.id,r.url,r.options),r])).values()];
  }
  statuses(resources:Resource[]) {
    return this.unique(resources).map(r=>({name:r.name,...this.snapshots.status(r.kind,r.id,r.url,r.options)}));
  }
  all():Resource[] {
    const collect = (kind:string,id:string) => {
      try { return this.collect(kind,id); }
      catch (error) {
        if (!(error instanceof ResourceAccessError)) throw error;
        console.warn(`跳过无权访问的资源依赖：${kind}:${id}`);
        return [];
      }
    };
    return this.unique([
      ...this.additionalResources(),
      ...this.store.list('source').flatMap(s=>collect('source',s.id)),
      ...this.store.list('ruleset').flatMap(s=>collect('ruleset',s.id)),
      ...this.store.list('profile').flatMap(p=>collect('profile',p.id)),
      ...this.store.listLatestTemplates().flatMap(t=>Object.values(this.renderer.collectRules({id:'',name:'',nodeSets:[],chains:[],refPolicy:{default:'wrap'},overlay:{},template:{id:t.id,follow:'latest'}} satisfies ProfileDoc,t).rulesets).flatMap(rs=>this.ruleResources(rs as RuleSetDoc,'public-template'))),
    ]);
  }
  private async each(resources:Resource[],read:(r:Resource,index:number)=>Promise<void>) {
    let next = 0;
    const results = await Promise.allSettled(Array.from({length:Math.min(4,resources.length)},async()=>{
      while (!this.stopping && next < resources.length) {
        const index = next++;
        await read(resources[index]!,index);
      }
    }));
    const errors = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (errors.length) throw new AggregateError(errors.map(r => r.reason), '资源刷新执行失败');
  }
  startJob(owner:string,kind:string,id:string,explicit?:Resource[]):RefreshJob {
    if (this.stopping) throw new Error('服务正在关闭');
    const existing = this.store.db.prepare('SELECT data FROM refresh_jobs WHERE owner = ? ORDER BY at DESC').all(owner) as {data:string}[];
    for (const row of existing) { const j = JSON.parse(this.store.cipher.decrypt(row.data)) as RefreshJob;if(j.state==='running' && j.kind===kind && j.documentId===id) return j; }
    const resources = this.unique(explicit ?? this.collect(kind,id));
    const dependencyKey = (items:Resource[]) => JSON.stringify(this.unique(items).map(r=>this.snapshots.identity(r.kind,r.id,r.url,r.options)).sort());
    const initialDependencies = dependencyKey(resources);
    const job:RefreshJob = {id:randomId(),owner,kind,documentId:id,state:'running',total:resources.length,completed:0,results:resources.map(r=>({name:r.name,state:'pending',available:this.snapshots.status(r.kind,r.id,r.url,r.options).available}))};
    this.save(job);
    const work = (async()=>{
      await this.each(resources,async (r,index)=>{
        if (!explicit) {
          const root = this.store.getWithOwner(kind as 'source'|'collection'|'ruleset'|'profile', id);
          if (!root || root.owner !== owner) throw new ResourceAccessError();
          if (dependencyKey(this.collect(kind,id)) !== initialDependencies) throw new Error('刷新期间资源配置已变化，请重新刷新');
        }
        const item = job.results[index]!;
        item.state = 'running';this.save(job);
        const result = await this.snapshots.refresh(r.kind,r.id,r.url,r.options);
        Object.assign(item,{state:'done',ok:result.ok,available:!!this.store.latestSnapshot(r.kind,result.ownerId,r.url),error:result.error});
        job.completed++; this.save(job);
      });
      if (this.stopping) { job.state='interrupted';job.error='服务关闭，刷新任务已中断';return; }
      if (!explicit && dependencyKey(this.collect(kind,id)) !== initialDependencies) {
        job.state='interrupted';job.error='刷新期间资源配置已变化，请重新刷新';return;
      }
      if (kind === 'profile') {
        // 按已发布的目标重建，同时保证默认 Mihomo 配置可立即获取。
        const targets = this.store.db.prepare('SELECT target FROM last_good WHERE profile_id = ?').all(id) as {target:string}[];
        const failures:string[]=[];
        for (const target of new Set(['mihomo:any',...targets.map(t=>t.target)])) {
          const [client,platform] = target.split(':');
          if(client !== 'mihomo' && client !== 'stash') continue;
          const result = await this.renderer.render(id,{client,...(platform !== 'any' ? {platform:platform as 'ios'} : {})});
          if(!result.ok || result.source==='last-good') failures.push(!result.ok ? result.message : result.report.filter(r=>r.level==='error').map(r=>r.message).join('；') || '生成失败，使用上次成功配置');
        }
        job.render={ok:!failures.length,...(failures.length ? {error:failures.join('；')} : {})};
      }
      if (!explicit && dependencyKey(this.collect(kind,id)) !== initialDependencies) {
        job.state='interrupted';job.error='刷新期间资源配置已变化，请重新刷新';return;
      }
      job.state='done';
    })().catch(error=>{job.state='interrupted';job.error=error instanceof Error?error.message:String(error);}).finally(()=>{if(job.state==='interrupted')this.interruptPending(job);this.save(job);this.running.delete(job.id);});
    this.running.set(job.id,work);
    return job;
  }
  tick():Promise<void> {
    if (this.stopping) return Promise.resolve();
    if (this.ticking) return this.ticking;
    const work = (async()=>{
      await this.each(this.all(),async r=>{
        const status=this.snapshots.status(r.kind,r.id,r.url,r.options);
        if(status.nextFetchAt===undefined || this.now()>=status.nextFetchAt) await this.snapshots.get(r.kind,r.id,r.url,r.options);
      });
      this.store.db.prepare('DELETE FROM refresh_jobs WHERE at < ?').run(this.now()-7*86400000);
    })().finally(()=>{this.ticking=undefined;});
    this.ticking=work;return work;
  }
  start() {
    if(this.timer || this.stopping)return;
    const run=()=>void this.tick().catch(error=>console.error('资源调度失败',error));
    run();this.timer=setInterval(run,60_000);this.timer.unref();
  }
  async stop(){this.stopping=true;clearInterval(this.timer);await Promise.all([...this.running.values(),this.ticking]);}
}
