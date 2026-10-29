import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync, spawn as actualSpawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, symlink, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GitRepoCache } from '../src/rule-repos/git-cache.ts';
import type { RepoDefinition } from '../src/rule-repos/adapters.ts';

const transport = vi.hoisted(() => ({ url: '', hang: false, pids: [] as number[] }));
vi.mock('node:child_process', async importOriginal => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return { ...original, spawn: (...args: Parameters<typeof actualSpawn>) => {
    const [command, input, options] = args;
    if (command !== 'git') return original.spawn(...args);
    if (transport.hang) {
      const child = original.spawn(process.execPath, ['-e', "const {spawn}=require('child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(child.pid);setInterval(()=>{},1000)"], options);
      if (child.pid) transport.pids.push(child.pid);
      child.stdout?.on('data', data => { const pid = Number(String(data).trim()); if (pid) transport.pids.push(pid); });
      return child;
    }
    const rewritten = [...input!];
    const index = rewritten.indexOf('remote.origin.url');
    if (index >= 0) rewritten[index + 1] = transport.url;
    return original.spawn(command, rewritten, { ...options, env: { ...options?.env, GIT_ALLOW_PROTOCOL: 'file' } });
  } };
});
const roots: string[] = [];
const caches: GitRepoCache[] = [];
afterEach(async () => { transport.hang = false; for (const cache of caches.splice(0)) await cache.stop(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sf-git-cache-')); roots.push(root);
  const upstream = join(root, 'upstream'); await mkdir(upstream);
  const git = (...args: string[]) => execFileSync('git', ['-C', upstream, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } }).trim();
  git('init', '-b', 'main'); git('config', 'user.name', '测试'); git('config', 'user.email', 'test@example.invalid');
  git('config', 'uploadpack.allowFilter', 'true'); git('config', 'uploadpack.allowAnySHA1InWant', 'true');
  const path = "rules/深层/a/b/c/d/e/含 空格'的规则.list";
  await mkdir(join(upstream, 'rules/深层/a/b/c/d/e'), { recursive: true });
  await writeFile(join(upstream, path), 'DOMAIN,old.example\n'); await symlink("含 空格'的规则.list", join(upstream, 'rules/深层/a/b/c/d/e/link.list'));
  git('add', '.'); git('commit', '-m', '初始规则');
  git('checkout', '-b', 'other'); await writeFile(join(upstream, 'second.txt'), '.other.example\n'); git('add', '.'); git('commit', '-m', '第二分支'); git('checkout', 'main');
  transport.url = `file://${upstream}`;
  const cache = new GitRepoCache(join(root, 'cache')); caches.push(cache);
  const repo: RepoDefinition = { id: 'test', name: '测试', owner: 'example', repo: 'rules', refs: ['main', 'other'], license: '', scans: [] };
  return { root, upstream, git, cache, repo, path };
}
describe('真实 Git 本地缓存', () => {
  it('浅克隆覆盖深层目录和全部配置分支，忽略符号链接，正文按固定提交读取', async () => {
    const h = await fixture();
    const versions = await h.cache.sync(h.repo);
    expect(await h.cache.files(h.repo, versions.main!)).toEqual([h.path]);
    expect(await h.cache.files(h.repo, versions.other!)).toEqual([h.path, 'second.txt']);
    expect(await h.cache.read(h.repo, versions.main!, h.path)).toBe('DOMAIN,old.example\n');
    expect(await h.cache.read(h.repo, versions.other!, 'second.txt')).toBe('.other.example\n');
    expect(await h.cache.sync(h.repo)).toEqual(versions);
    await writeFile(join(h.upstream, h.path), 'DOMAIN,new.example\n'); h.git('add', '.'); h.git('commit', '-m', '更新规则');
    const updated = await h.cache.sync(h.repo);
    expect(updated.main).not.toBe(versions.main); expect(updated.other).toBe(versions.other);
    expect(await h.cache.read(h.repo, versions.main!, h.path)).toBe('DOMAIN,old.example\n');
    expect(await h.cache.read(h.repo, updated.main!, h.path)).toBe('DOMAIN,new.example\n');
    // 分支改写可恢复；不依赖父提交历史。
    h.git('checkout', '--orphan', 'replacement'); await writeFile(join(h.upstream, 'replacement.txt'), 'replacement.example'); h.git('add', '.'); h.git('commit', '-m', '替换历史'); h.git('branch', '-f', 'main', 'HEAD');
    const replaced = await h.cache.sync(h.repo); expect(replaced.main).not.toBe(updated.main);
  });
  it('分支缺失时更新失败，旧提交仍可读；恢复后继续同步，删除缓存可重建', async () => {
    const h = await fixture(); const versions = await h.cache.sync(h.repo);
    await expect(h.cache.sync({ ...h.repo, refs: ['main', 'missing'] })).rejects.toThrow('Git 更新失败');
    expect(await h.cache.files(h.repo, versions.main!)).toEqual([h.path]);
    expect(await h.cache.sync(h.repo)).toEqual(versions);
    await h.cache.remove(h.repo.id); expect(await readdir(join(h.root, 'cache'))).toEqual([]);
    expect(await h.cache.sync(h.repo)).toEqual(versions);
  });
  it('服务停止时终止 Git 及其子进程，释放锁且不留下进程', async () => {
    const h = await fixture(); transport.hang = true; transport.pids = [];
    const pending = h.cache.sync(h.repo); const rejected = expect(pending).rejects.toThrow('取消');
    await vi.waitFor(() => expect(transport.pids.length).toBe(2));
    await h.cache.stop(); await rejected;
    for (const pid of transport.pids) await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
    await expect(h.cache.sync(h.repo)).rejects.toThrow('已停止');
  });
});
