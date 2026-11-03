import { ResourceAccessError } from './resource-access.ts';
// 资源调度与手动刷新使用同一依赖收集和状态。任务持久化，重启后明确标记中断。
import type { NodeSetID } from '@sub-forge/core';
import { profileTemplate } from './profile-routing.ts';
import type { RuleSetDoc } from './docs.ts';
import { cacheCycleStart } from './cache-cycle.ts';
import { randomId } from './crypto.ts';
import type { RenderService } from './render.ts';
import type { RuleFetchParams, SnapshotService } from './snapshots.ts';
import type { Store } from './store.ts';

export type Resource = { kind:'source'; id:string; name:string; url:string } | { kind:'ruleset'; name:string; url:string; params:RuleFetchParams };
// 旧任务仅含已完成结果，没有 state；新任务从创建起保留完整、有序的资源列表。
export type RefreshResult = { name:string; state?:'pending'|'running'|'done'|'interrupted'; ok?:boolean; available:boolean; error?:string };
export type RefreshJob = { id:string; owner:string; kind:string; documentId:string; documentBound?:boolean; state:'running'|'done'|'interrupted'; total:number; completed:number; results:RefreshResult[]; render?:{ok:boolean;error?:string}; error?:string };
export class ResourceService {
  private readonly running = new Map<string, Promise<void>>();
  private timer?: ReturnType<typeof setInterval>;
  private stopping = false;
  private lastSweepCycle?: number;
  constructor(private store:Store,private snapshots:SnapshotService,private renderer:RenderService,private now:()=>number=Date.now) {
    store.documentDeleteHooks.add(this.dropDocumentJobs);
    for (const row of store.db.prepare('SELECT data FROM refresh_jobs').all() as {data:string}[]) {
      const job = JSON.parse(row.data) as RefreshJob;
      if (job.state === 'running') { job.state = 'interrupted';job.error = '服务重启，刷新任务已中断，请重新刷新';this.interruptPending(job);this.save(job); }
    }
  }
  private readonly dropDocumentJobs = (kind:string,id:string) => {
    for (const row of this.store.db.prepare('SELECT id,data FROM refresh_jobs').all() as {id:string;data:string}[]) {
      const job = JSON.parse(row.data) as RefreshJob;
      if (job.kind === kind && job.documentId === id) this.store.db.prepare('DELETE FROM refresh_jobs WHERE id = ?').run(row.id);
    }
  };
  private interruptPending(job:RefreshJob) {
    for (const result of job.results) {
      if (result.ok === undefined) result.state = 'interrupted';
    }
  }
  private save(job:RefreshJob) {
    if (job.documentBound !== false && ['profile', 'source', 'collection', 'ruleset'].includes(job.kind) && !this.store.get(job.kind as 'profile' | 'source' | 'collection' | 'ruleset', job.documentId)) return;
    this.store.db.prepare('INSERT OR REPLACE INTO refresh_jobs VALUES (?,?,?,?)').run(job.id,job.owner,JSON.stringify(job),this.now());
    this.store.changed();
  }
  getJob(id:string):RefreshJob|undefined {
    const row = this.store.db.prepare('SELECT data FROM refresh_jobs WHERE id = ?').get(id) as {data:string}|undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  ruleResources(rs:RuleSetDoc):Resource[] {
    return rs.sources.filter(s=>s.enabled !== false && s.kind === 'remote' && s.url).map(s=>({kind:'ruleset',name:`${rs.name} / ${s.name || s.id}`,url:s.url!,params:{...s.fetch,format:s.format,behavior:s.behavior}}));
  }
  nodeResources(refs:NodeSetID[], owner?:string|null):Resource[] {
    return this.renderer.collectNodeSets(refs,owner).sources.map(s=>({kind:'source',id:s.id,name:s.name,url:s.url}));
  }
  collect(kind:string,id:string):Resource[] {
    if (kind === 'source' || kind === 'collection') return this.nodeResources([{type:kind,id}]);
    if (kind === 'ruleset') { const rs = this.store.get('ruleset',id); return rs ? this.ruleResources(rs) : []; }
    if (kind !== 'profile') throw new Error('不支持的刷新对象');
    const profile = this.store.get('profile',id);
    if (!profile) throw new Error('配置订阅不存在');
    const template = profile.routing?.mode === 'independent' ? undefined : profileTemplate(profile,(key,v)=>this.store.getTemplate(key,v));
    return [...this.nodeResources(profile.nodeSets.map(n=>n.ref),this.store.getWithOwner('profile',id)?.owner),...Object.values(this.renderer.collectRules(profile,template).rulesets).flatMap(rs=>this.ruleResources(rs as RuleSetDoc))];
  }
  private status(r:Resource) {
    return r.kind === 'source' ? this.snapshots.nodeStatus(r) : this.snapshots.ruleStatus(r.url,r.params);
  }
  unique(resources:Resource[]):Resource[] {
    return [...new Map(resources.map(r=>[this.status(r).resource,r])).values()];
  }
  statuses(resources:Resource[]) {
    return [...new Map(resources.map(r=>{ const status = this.status(r); return [status.resource,{name:r.name,...status}]; })).values()];
  }
  /** 系统页只列节点订阅：规则到期即失效，失败留给下次请求，不算资源异常。 */
  all():Resource[] {
    return this.store.list('source').map(s=>({kind:'source',id:s.id,name:s.name,url:s.url}));
  }
  /** 手动刷新：失败写入任务结果；节点继续用旧内容，规则保留本周期仍有效的快照。 */
  private async refresh(r:Resource):Promise<{ok:boolean;available:boolean;error?:string}> {
    if (r.kind === 'source') {
      const row = await this.snapshots.refreshNodeSource(r);
      return {ok:row.ok,available:this.snapshots.nodeStatus(r).available,error:row.error};
    }
    try { await this.snapshots.refreshRuleContent(r.url,r.params); return {ok:true,available:true}; }
    catch (error) { return {ok:false,available:this.snapshots.ruleStatus(r.url,r.params).available,error:(error as Error).message}; }
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
    for (const row of existing) { const j = JSON.parse(row.data) as RefreshJob;if(j.state==='running' && j.kind===kind && j.documentId===id) return j; }
    const resources = this.unique(explicit ?? this.collect(kind,id));
    const dependencyKey = (items:Resource[]) => JSON.stringify(this.unique(items).map(r=>this.status(r).resource).sort());
    const initialDependencies = dependencyKey(resources);
    const job:RefreshJob = {id:randomId(),owner,kind,documentId:id,documentBound:!explicit,state:'running',total:resources.length,completed:0,results:resources.map(r=>({name:r.name,state:'pending',available:this.status(r).available}))};
    this.save(job);
    let cancelled = false;
    const invalidate = (deletedKind:string,deletedId:string) => { if (!explicit && deletedKind === kind && deletedId === id) cancelled = true; };
    this.store.invalidationListeners.add(invalidate);
    const work = (async()=>{
      await this.each(resources,async (r,index)=>{
        if (cancelled) throw new Error('刷新对象已删除');
        if (!explicit) {
          const root = this.store.getWithOwner(kind as 'source'|'collection'|'ruleset'|'profile', id);
          if (!root || kind !== 'ruleset' && root.owner !== owner) throw new ResourceAccessError();
          if (dependencyKey(this.collect(kind,id)) !== initialDependencies) throw new Error('刷新期间资源配置已变化，请重新刷新');
        }
        const item = job.results[index]!;
        item.state = 'running';this.save(job);
        const result = await this.refresh(r);
        if (cancelled) throw new Error('刷新对象已删除');
        Object.assign(item,{state:'done',...result});
        job.completed++; this.save(job);
      });
      if (this.stopping) { job.state='interrupted';job.error='服务关闭，刷新任务已中断';return; }
      if (!explicit && dependencyKey(this.collect(kind,id)) !== initialDependencies) {
        job.state='interrupted';job.error='刷新期间资源配置已变化，请重新刷新';return;
      }
      if (kind === 'profile') {
        // 确认默认 Mihomo 配置可立即生成；其他客户端在各自拉取时渲染，不把未使用的客户端限制算作失败。
        const result = await this.renderer.render(id,{client:'mihomo'});
        job.render=result.ok ? {ok:true} : {ok:false,error:result.message};
      }
      if (!explicit && dependencyKey(this.collect(kind,id)) !== initialDependencies) {
        job.state='interrupted';job.error='刷新期间资源配置已变化，请重新刷新';return;
      }
      job.state='done';
    })().catch(error=>{job.state='interrupted';job.error=error instanceof Error?error.message:String(error);}).finally(()=>{if(job.state==='interrupted')this.interruptPending(job);if(!cancelled)this.save(job);this.running.delete(job.id);this.store.invalidationListeners.delete(invalidate);});
    this.running.set(job.id,work);
    return job;
  }
  /** 只清理、不拉取：过期规则快照到期立刻删除，节点快照永不按时间清理。 */
  sweep():void {
    if (this.stopping) return;
    this.store.deleteExpiredRuleSnapshots(cacheCycleStart(this.now(),this.store.resourceCacheTtlSec));
    this.store.db.prepare('DELETE FROM refresh_jobs WHERE at < ?').run(this.now()-7*86400000);
  }
  /** 每 60 秒检查，跨过周期边界才清理；修改设置后无需重启，启动时补做一次。 */
  start() {
    if(this.timer || this.stopping)return;
    const run=()=>{
      const cycle=cacheCycleStart(this.now(),this.store.resourceCacheTtlSec);
      if(this.lastSweepCycle===cycle)return;
      try { this.sweep();this.lastSweepCycle=cycle; } catch (error) { console.error('资源清理失败',error); }
    };
    run();this.timer=setInterval(run,60_000);this.timer.unref();
  }
  async stop(){this.stopping=true;clearInterval(this.timer);await Promise.all(this.running.values());this.store.documentDeleteHooks.delete(this.dropDocumentJobs);}
}
