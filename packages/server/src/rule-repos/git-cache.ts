// 裸仓库只缓存所需分支；浅历史不限制目录层级。所有子进程均有超时并在退出时回收。
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { RepoDefinition } from './adapters.ts';

export interface RepoCache {
  sync(repo: RepoDefinition): Promise<Record<string, string>>;
  files(repo: RepoDefinition, commit: string): Promise<string[]>;
  read(repo: RepoDefinition, commit: string, path: string): Promise<string>;
  remove(id: string): Promise<void>;
  stop(): Promise<void>;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export class GitRepoCache implements RepoCache {
  private stopped = false;
  private running = new Set<() => void>();
  private jobs = new Set<Promise<unknown>>();
  private queues = new Map<string, Promise<unknown>>();
  constructor(private root: string) { this.root = resolve(root); }
  private directory(repo: RepoDefinition) { return join(this.root, hash(repo.id), hash(`${repo.owner.toLowerCase()}/${repo.repo.toLowerCase()}`)); }
  private async locked<T>(repo: RepoDefinition, action: (dir: string) => Promise<T>): Promise<T> {
    const dir = this.directory(repo);
    const previous = this.queues.get(dir);
    const job = (async () => {
      if (previous) await Promise.allSettled([previous]); // 前一调用已向调用方报告错误，队列仍允许重试。
      if (this.stopped) throw new Error('Git 缓存已停止');
      await mkdir(dir, { recursive: true });
      const lockPath = join(dir, 'sync.lock');
      let lock;
      try { lock = await open(lockPath, 'wx'); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const pid = Number(await readFile(lockPath, 'utf8'));
        if (!Number.isInteger(pid) || pid <= 0) throw new Error('Git 缓存锁无效，请检查缓存目录');
        try { process.kill(pid, 0); throw new Error('Git 缓存正在被其他任务使用'); }
        catch (probe) {
          if ((probe as NodeJS.ErrnoException).code !== 'ESRCH') throw probe;
          await rm(lockPath); lock = await open(lockPath, 'wx');
        }
      }
      try { await lock.writeFile(String(process.pid)); return await action(dir); }
      finally { await lock.close(); await rm(lockPath, { force: true }); }
    })();
    this.queues.set(dir, job); this.jobs.add(job);
    try { return await job; }
    finally { this.jobs.delete(job); if (this.queues.get(dir) === job) this.queues.delete(dir); }
  }
  private run(dir: string, args: string[]): Promise<string> {
    if (this.stopped) return Promise.reject(new Error('Git 缓存已停止'));
    return new Promise((resolveResult, reject) => {
      // 不继承外部 Git 路径、认证或 URL 重写配置；公开仓库使用匿名 HTTPS。
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
      Object.assign(env, { GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_ALLOW_PROTOCOL: 'https' });
      const child = spawn('git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'http.followRedirects=false', '-C', dir, ...args],
        { env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
      let output = Buffer.alloc(0), errors = '', failure: Error | undefined;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const kill = (signal: NodeJS.Signals) => {
        if (!child.pid) return;
        try { if (process.platform === 'win32') child.kill(signal); else process.kill(-child.pid, signal); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') failure ??= error as Error; }
      };
      const cancel = () => { failure ??= new Error('Git 操作已取消或超时'); kill('SIGTERM'); killTimer ??= setTimeout(() => kill('SIGKILL'), 500); };
      this.running.add(cancel);
      const timeout = setTimeout(cancel, 120_000);
      child.stdout.on('data', (data: Buffer) => {
        if (output.length + data.length > 32 * 1024 * 1024) { failure = new Error('Git 输出超过 32 MiB 上限'); cancel(); }
        else output = Buffer.concat([output, data]);
      });
      child.stderr.on('data', (data: Buffer) => { errors = (errors + data.toString('utf8')).slice(-4000); });
      child.on('error', error => { failure = error; });
      child.on('close', code => {
        clearTimeout(timeout);
        if (killTimer) { kill('SIGKILL'); clearTimeout(killTimer); }
        this.running.delete(cancel);
        if (failure || code !== 0) reject(failure ?? new Error(`Git 更新失败（${code}）：${errors.trim()}`));
        else resolveResult(output.toString('utf8'));
      });
    });
  }
  sync(repo: RepoDefinition) {
    return this.locked(repo, async dir => {
      await this.run(dir, ['init', '--bare', '--quiet']);
      const url = `https://github.com/${repo.owner}/${repo.repo}.git`;
      await this.run(dir, ['config', 'remote.origin.url', url]);
      await this.run(dir, ['config', 'remote.origin.promisor', 'true']);
      await this.run(dir, ['config', 'remote.origin.partialclonefilter', 'blob:none']);
      // 一次 fetch 原子更新所有配置分支；服务器强制更新也只替换专用缓存引用。
      const refs = repo.refs.map(ref => `+refs/heads/${ref}:refs/cache/${hash(ref)}`);
      await this.run(dir, ['fetch', '--atomic', '--no-tags', '--depth=1', '--filter=blob:none', 'origin', ...refs]);
      const revisions: Record<string, string> = {};
      for (const ref of repo.refs) {
        const sha = (await this.run(dir, ['rev-parse', '--verify', `refs/cache/${hash(ref)}^{commit}`])).trim();
        if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Git 返回无效提交');
        revisions[ref] = sha;
      }
      return revisions;
    });
  }
  files(repo: RepoDefinition, commit: string) {
    return this.locked(repo, async dir => {
      if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('无效索引提交');
      const result = await this.run(dir, ['ls-tree', '-r', '-z', '--full-tree', commit]);
      return result.split('\0').filter(Boolean).flatMap(line => {
        const tab = line.indexOf('\t');
        // 忽略符号链接和子模块，不读取对象大小，避免触发正文下载。
        return /^100(?:644|755) blob [a-f0-9]{40}$/.test(line.slice(0, tab)) ? [line.slice(tab + 1)] : [];
      });
    });
  }
  read(repo: RepoDefinition, commit: string, path: string) {
    return this.locked(repo, async dir => {
      if (!/^[a-f0-9]{40}$/.test(commit) || !path || path.includes('\0') || path.startsWith('/') || path.split('/').some(p => p === '..' || p === '.')) throw new Error('无效索引文件');
      return this.run(dir, ['show', `${commit}:${path}`]);
    });
  }
  async remove(id: string) {
    // 服务层在删除前拒绝进行中的索引；缓存正文任务结束后再删除。
    await Promise.allSettled([...this.jobs]);
    await rm(join(this.root, hash(id)), { recursive: true, force: true });
  }
  async stop() {
    this.stopped = true;
    for (const cancel of this.running) cancel();
    await Promise.allSettled([...this.jobs]);
  }
}
