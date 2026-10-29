// 索引场景使用本地模拟数据协议，不发送网络请求；Git 传输另用真实本地仓库验证。
import { createHash } from 'node:crypto';
import { vi } from 'vitest';
import type { RepoCache } from '../src/rule-repos/git-cache.ts';
import type { UpstreamFetcher } from '../src/net/upstream.ts';
import { rawUrl, type RepoDefinition } from '../src/rule-repos/adapters.ts';
export function fixtureCache(fetcher: UpstreamFetcher): RepoCache {
  const trees = new Map<string, string>();
  const refs = new Map<string, string>();
  return {
    inspect: vi.fn(async () => ({ defaultBranch: 'main', branches: ['main', 'master', 'other', 'surge-rule-set', 'surge-domain-set'] })),
    sync: vi.fn(async (repo: RepoDefinition) => {
      const revisions: Record<string, string> = {};
      for (const ref of repo.refs) {
        const response = await fetcher(`fixture://git/${repo.owner}/${repo.repo}/commits/${encodeURIComponent(ref)}`);
        const commit = JSON.parse(response.body);
        const sha = createHash('sha1').update(commit.sha + ref).digest('hex');
        revisions[ref] = sha;
        refs.set(`${repo.id}:${sha}`, ref);
        trees.set(`${repo.id}:${sha}`, commit.commit.tree.sha);
      }
      return revisions;
    }),
    files: vi.fn(async (repo, commit) => {
      const response = await fetcher(`fixture://git/${repo.owner}/${repo.repo}/git/trees/${trees.get(`${repo.id}:${commit}`)}?recursive=1`);
      return JSON.parse(response.body).tree.filter((n: { type: string; mode?: string }) => n.type === 'blob' && n.mode !== '120000').map((n: { path: string }) => n.path);
    }),
    read: vi.fn(async (repo: RepoDefinition, commit: string, path: string) => {
      const ref = refs.get(`${repo.id}:${commit}`) ?? repo.scans.find(s => !s.directory || path.startsWith(s.directory + '/'))?.ref ?? repo.refs[0]!;
      const response = await fetcher(rawUrl(repo, { ref, path, format: 'auto' }));
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
      return response.body;
    }),
    remove: vi.fn(async () => {}), stop: vi.fn(async () => {}),
  };
}
