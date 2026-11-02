// 管理接口测试用的小工具：带 cookie 的请求客户端、内存数据库上的完整应用。

import { parseTrustedProxies } from '../src/net/client-ip.ts';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/crypto.ts';
import type { UpstreamFetcher } from '../src/net/upstream.ts';
import { RenderService } from '../src/render.ts';
import { SnapshotService } from '../src/snapshots.ts';
import { Store, type Role } from '../src/store.ts';

export function setupApp(opts: { fetcher?: UpstreamFetcher; now?: () => number; trustedProxies?: string; allowedOrigins?: string[] } = {}) {
  let t = 1_700_000_000_000;
  const now = opts.now ?? (() => t);
  const store = new Store(':memory:', { now });
  const fetcher: UpstreamFetcher = opts.fetcher ?? (async (url) => { throw new Error(`测试中未提供 ${url}`); });
  const snapshots = new SnapshotService(store, fetcher, now);
  const renderer = new RenderService(store, snapshots, { publicUrl: 'https://sub.test' });
  const app = createApp({ store, renderer, snapshots, now, publicUrl: 'https://sub.test', trustedProxies: parseTrustedProxies(opts.trustedProxies), ...(opts.allowedOrigins ? { allowedOrigins: opts.allowedOrigins } : {}) });
  return { store, app, snapshots, renderer, advance: (ms: number) => { t += ms; } };
}

/** 按 URL 返回固定正文的上游，供远程订阅源测试使用 */
export const serve = (bodies: Record<string, string>): UpstreamFetcher => async (url) => {
  const body = bodies[url];
  if (body === undefined) throw new Error(`测试中未提供 ${url}`);
  return { status: 200, body };
};

export async function addUser(store: Store, username: string, role: Role = 'user', password = 'password-123') {
  return store.createUser({ username, passwordHash: await hashPassword(password), role });
}

/** 模拟浏览器：保存 Set-Cookie，后续请求带上 */
export function client(app: ReturnType<typeof setupApp>['app']) {
  let cookie = '';
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.request(path, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const set = res.headers.get('set-cookie');
    if (set) {
      const m = /sf_session=([^;]*)/.exec(set);
      if (m) cookie = m[1] ? `sf_session=${m[1]}` : '';
    }
    const text = await res.text();
    let json: any;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
    return { status: res.status, json, text, headers: res.headers };
  };
  return {
    get: (p: string) => call('GET', p),
    post: (p: string, b?: unknown, h?: Record<string, string>) => call('POST', p, b ?? {}, h),
    put: (p: string, b: unknown) => call('PUT', p, b),
    patch: (p: string, b: unknown) => call('PATCH', p, b),
    del: (p: string) => call('DELETE', p),
    raw: call,
    login: async (username: string, password = 'password-123') => call('POST', '/auth/login', { username, password }),
  };
}

/** 旧渲染场景补齐真实的用户归属，凭证仍严格按用户发行。 */
export function issueProfileToken(store: Store, t: { token: string; profileId: string; label?: string }): void {
  const owner = store.getWithOwner('profile', t.profileId)?.owner ?? 'fixture-user';
  if (!store.getUser(owner)) store.db.prepare('INSERT INTO users (id,username,password_hash,role,created_at) VALUES (?,?,?,?,?)').run(owner, owner, 'fixture-hash', 'user', 1);
  store.db.prepare("UPDATE docs SET owner = ? WHERE owner IS NULL AND kind IN ('profile','source','collection','local')").run(owner);
  store.putToken({ token: t.token, userId: owner });
}

/** 合并公共产物表与订阅专属规则正文，供渲染断言使用。 */
export function ruleBodies(store: Store, render: import('../src/render.ts').StoredRender): Record<string, string> {
  return Object.fromEntries([...render.ruleResources.map(key => store.getSharedRule<import('../src/shared-rules.ts').SharedRuleRecord>(key)!), ...Object.values(render.privateRules ?? {})].map((r, index) => {
    const name = `rs_${(r.reference.matcher.kind === 'ruleset' ? r.reference.matcher.id : `local_${index}`).replace(/[^A-Za-z0-9_-]/g, '_')}${r.reference.options?.src ? '_src' : ''}_${r.body.startsWith('#subforge-binary-mrs\n') ? 'binary.mrs' : 'classical.list'}`;
    return [name, r.body];
  }));
}

type TestClient = ReturnType<typeof client>;

/** 按前端流程预览规则集：逐个读取来源，再转换。 */
export async function previewRuleset(c: TestClient, input: { id?: string; ruleset?: { sources?: { id: string }[]; overrides?: unknown; [key: string]: unknown }; source?: string; client?: string; [key: string]: unknown }) {
  const sources = input.ruleset?.sources;
  if (!Array.isArray(sources)) return { status: 400, json: {}, text: '' } as Awaited<ReturnType<TestClient['post']>>;
  const loaded: { content?: string; status: Record<string, unknown> }[] = [];
  for (const source of sources) {
    const read = await c.post('/api/rulesets/source', { ...(input.id ? { id: input.id } : {}), source });
    if (read.status !== 200) return read;
    loaded.push(read.json);
  }
  const res = await c.post('/api/rules/convert', {
    inputs: sources.map((source, i) => ({ source, content: loaded[i]!.content ?? '' })),
    overrides: input.ruleset?.overrides, client: input.client ?? 'mihomo', ...(input.source !== undefined ? { sourceId: input.source } : {}),
  });
  if (res.status !== 200) return res;
  const stats = res.json.stats;
  const diagnostics = res.json.diagnostics as { kind: string; text: string; reason: string }[];
  return { ...res, json: { ...res.json, sources: loaded.map(item => item.status), total: res.json.lines.length,
    stats: input.source ? undefined : { domain: stats.domain, classical: stats.classical, ipcidr: stats.ipcidr, total: stats.output + stats.duplicates + stats.unsupported, duplicates: stats.duplicates },
    rejected: diagnostics.filter(d => d.kind === 'invalid' || d.kind === 'unimplemented'),
    dropped: diagnostics.filter(d => d.kind === 'client').map(d => ({ rule: d.text, reason: d.reason })),
    notes: diagnostics.filter(d => d.kind === 'degraded').map(d => d.reason) } };
}

/** 按前端流程关联仓库文件：解析来源，再保存为规则集。 */
export async function importRepoFile(c: TestClient, input: { repo: string; path: string; file?: unknown }) {
  const resolved = await c.post('/api/rule-options/resolve', { source: 'repository', repo: input.repo, entry: input.path, ...(input.file !== undefined ? { file: input.file } : {}) });
  if (resolved.status !== 200) return resolved;
  return c.post('/api/rulesets', { name: resolved.json.matcher.repository.name, sources: resolved.json.matcher.repository.sources });
}

/** 直接读取已构建的仓库索引。 */
export function indexedEntries(store: Store, q = '', repo?: string, targetClient?: string) {
  const rows = store.db.prepare('SELECT data FROM rule_repo_entries ORDER BY key').all() as { data: string }[];
  const items = rows.map(row => JSON.parse(row.data) as { repo: string; path: string; name: string; variants: { client: string }[] })
    .filter(e => (!repo || e.repo === repo) && e.name.toLowerCase().includes(q.toLowerCase()) && (!targetClient || e.variants.some(v => v.client === targetClient || v.client === 'any')));
  return { items, total: items.length };
}

/** 订阅接口要求 routing；测试只关心节点或规则时使用的独立配置。 */
export const independentRouting = (rules: unknown[] = []) => ({ mode: 'independent' as const, config: { groups: [], rules, final: { kind: 'builtin' as const, name: 'DIRECT' as const } } });
