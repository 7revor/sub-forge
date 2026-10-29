// 规则引用验收使用隔离内存库、确定性 Git 索引与上游正文，应用 API 和渲染器保持真实实现。
import { createApp } from '../src/app.ts';
import { RuleRepoService } from '../src/rule-repos/service.ts';
import type { RepoCache } from '../src/rule-repos/git-cache.ts';
import { addUser, client, setupApp } from './helpers.ts';

export async function setupRuleReferences() {
  let paths = ['rule/Surge/Google/Google.list', 'rule/Surge/OpenAI/OpenAI.list'];
  let commit = 'a'.repeat(40);
  let body = 'DOMAIN,google.example.test\nIP-CIDR,198.51.100.0/24';
  const calls: string[] = [];
  const env = setupApp({ fetcher: async url => { calls.push(url); return { status: 200, body }; } });
  const cache: RepoCache = {
    inspect: async () => ({ defaultBranch: 'master', branches: ['master', 'surge-rule-set', 'surge-domain-set'] }),
    sync: async repo => Object.fromEntries(repo.refs.map(ref => [ref, commit])),
    files: async () => paths,
    read: async () => body, remove: async () => {}, stop: async () => {},
  };
  const repos = new RuleRepoService(env.store, async () => ({ status: 200, body }), Date.now, cache);
  await repos.refresh('blackmatrix7');
  repos.setEnabled('zydou', false);
  const app = createApp({ ...env, ruleRepos: repos, publicUrl: 'http://127.0.0.1:5186', allowedOrigins: ['http://127.0.0.1:5186'] });
  const user = await addUser(env.store, 'reference-admin', 'admin');
  const privateUser = await addUser(env.store, 'reference-user');
  const local = { id: 'local-google', name: 'Google', sources: [{ id: 'local-source', kind: 'local' as const, format: 'auto' as const, content: 'DOMAIN,local.example.test' }] };
  env.store.put('ruleset', local, user.id);
  env.store.put('ruleset', { ...local, id: 'private-google', name: 'Google 私有' }, privateUser.id);
  const admin = client(app);
  await admin.login('reference-admin');
  const resolve = async () => (await admin.post('/api/rule-options/resolve', { source: 'repository', repo: 'blackmatrix7', entry: 'Google' })).json.matcher;
  const stop = async () => { await repos.stop(); await env.snapshots.settled(); env.store.close(); };
  return { ...env, app, repos, user, privateUser, admin, resolve, calls, stop, setBody: (next: string) => { body = next; }, setPaths: (next: string[]) => { paths = next; commit = 'b'.repeat(40); } };
}
