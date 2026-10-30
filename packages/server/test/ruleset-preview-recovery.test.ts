import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { RuleSet, RuleSetSource } from '@sub-forge/core';
import type { RuleSetSourceDoc } from '../src/docs.ts';
import { addUser, client, setupApp } from './helpers.ts';

const environments: ReturnType<typeof setupApp>[] = [];
afterEach(async () => {
  for (const env of environments.splice(0)) { await env.snapshots.settled(); env.store.close(); }
});
const remote: RuleSetSourceDoc = { id: 'remote', kind: 'remote', format: 'auto', url: 'https://rules.example.test/list', fetch: { ttlSec: 300 } };
async function fixture(rs: RuleSet, options: Parameters<typeof setupApp>[0] = {}) {
  const env = setupApp(options); environments.push(env);
  const user = await addUser(env.store, 'alice');
  env.store.put('ruleset', rs, user.id);
  env.store.put('profile', { id: 'p', name: '回归订阅', nodeSets: [], chains: [], refPolicy: { default: 'wrap' }, overlay: {
    extraRules: [{ anchor: 'top', rule: { id: 'r', matcher: { kind: 'ruleset', id: rs.id }, target: { kind: 'builtin', name: 'REJECT' } } }],
  } }, user.id);
  env.store.putToken({ token: 'preview-test', profileId: 'p' });
  const api = client(env.app); await api.login('alice');
  const read = (refresh = false) => api.post('/api/rulesets/source', { id: rs.id, source: rs.sources[0], refresh });
  const preview = (content: string) => api.post('/api/rules/convert', { inputs: [{ source: rs.sources[0], content }], overrides: rs.overrides, client: 'mihomo' });
  const download = async (platform?: string) => {
    const sub = await env.app.request(`/sub/preview-test${platform ? `?platform=${platform}` : ''}`);
    expect(sub.status).toBe(200);
    const config = parse(await sub.text());
    const provider = Object.values(config['rule-providers'])[0] as { url: string };
    const url = new URL(provider.url);
    const file = await env.app.request(url.pathname + url.search);
    expect(file.status).toBe(200);
    return file.text();
  };
  return { ...env, api, read, preview, download };
}

describe('规则预览、实际下发与来源异常恢复', () => {
  it.each([undefined, 'android'])('畸形本地 YAML 保留注释，预览与真实 LIST 完全一致（%s）', async platform => {
    const rs: RuleSet = { id: 'r', name: '畸形 YAML', sources: [
      { id: 'bad', kind: 'local', format: 'auto', content: 'payload: [\n  invalid' },
      { id: 'good', kind: 'local', format: 'auto', content: '# 标题\nDOMAIN,good.test\nPROCESS-NAME,Example\nDOMAIN,good.test' },
    ] };
    const h = await fixture(rs);
    const preview = await h.api.post('/api/rules/convert', { inputs: rs.sources.map(source => ({ source, content: source.content })), client: 'mihomo', platform });
    expect(preview.status).toBe(200);
    expect(preview.json.stats).toMatchObject({ rejected: 2, duplicates: 1 });
    expect(preview.json.lines.slice(0, 2).every((l: string) => l.startsWith('#'))).toBe(true);
    expect(await h.download(platform)).toBe(preview.json.lines.join('\n') + '\n');
  });

  it('首次失败不暗中补读；显式重试立即恢复正式快照和订阅，无需等待退避到期', async () => {
    let calls = 0;
    const h = await fixture({ id: 'r', name: '恢复', overrides: [{ match: 'DOMAIN,unused.fixture.test', override: { when: { client: 'mihomo' as const }, action: { drop: true as const } } }], sources: [remote] }, { fetcher: async () => {
      if (++calls === 1) throw new Error('瞬时上游错误');
      return { status: 200, body: 'DOMAIN,recovered.test' };
    } });
    const failed = await h.read();
    expect(failed.json.status).toMatchObject({ ok: false, error: '瞬时上游错误' });
    expect(failed.json.content).toBeUndefined();
    expect(calls).toBe(1);
    expect((await h.app.request('/sub/preview-test')).status).toBe(503);
    expect((await h.read()).json.status.ok).toBe(false);
    expect(calls).toBe(1);
    const recovered = await h.read(true);
    expect(recovered.json.status).toMatchObject({ ok: true, stale: false });
    expect(h.store.latestSnapshot('ruleset', 'r', remote.url!)?.body).toBe(recovered.json.content);
    const preview = await h.preview(recovered.json.content);
    expect(await h.download()).toBe(preview.json.lines.join('\n') + '\n');
    expect(calls).toBe(2);
  });

  it('过期来源等待后台同一请求完成，预览与下发均使用新快照', async () => {
    let calls = 0; let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const h = await fixture({ id: 'r', name: '过期', overrides: [{ match: 'DOMAIN,unused.fixture.test', override: { when: { client: 'mihomo' as const }, action: { drop: true as const } } }], sources: [remote] }, { fetcher: async () => {
      if (++calls > 1) await waiting;
      return { status: 200, body: calls === 1 ? 'DOMAIN,old.test' : 'DOMAIN,new.test' };
    } });
    await h.read(); h.advance(86_401_000);
    const refreshing = h.snapshots.get('ruleset', 'r', remote.url!, { ttlSec: 300 });
    const reading = h.read();
    release();
    const loaded = await reading;
    expect((await refreshing).snapshot?.body).toBe('DOMAIN,new.test');
    expect(loaded.json).toMatchObject({ content: 'DOMAIN,new.test', status: { ok: true, stale: false } });
    const preview = await h.preview(loaded.json.content);
    expect(await h.download()).toBe(preview.json.lines.join('\n') + '\n');
    expect(calls).toBe(2);
  });

  it('刷新失败保留旧快照及错误标识，显式重试相同正文后清除失败状态', async () => {
    let fail = false; let calls = 0;
    const h = await fixture({ id: 'r', name: '旧快照保护', overrides: [{ match: 'DOMAIN,unused.fixture.test', override: { when: { client: 'mihomo' as const }, action: { drop: true as const } } }], sources: [remote] }, { fetcher: async () => {
      calls++; if (fail) throw new Error('刷新暂时失败');
      return { status: 200, body: 'DOMAIN,same.test' };
    } });
    const before = await h.read(); const original = await h.download();
    h.advance(86_401_000); fail = true;
    const failed = await h.read();
    expect(failed.json).toMatchObject({ content: before.json.content, status: { ok: false, stale: true, error: '刷新暂时失败' } });
    expect(await h.download()).toBe(original);
    fail = false;
    const recovered = await h.read(true);
    expect(recovered.json.status).toMatchObject({ ok: true, stale: false });
    expect((await h.read()).json.status.ok).toBe(true);
    expect(await h.download()).toBe((await h.preview(recovered.json.content)).json.lines.join('\n') + '\n');
    expect(calls).toBe(3);
  });

  it('草稿失败不缓存，每次读取不复用完成结果，并发刷新合并且不写正式快照', async () => {
    let calls = 0; let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const h = await fixture({ id: 'r', name: '草稿', sources: [remote] }, { fetcher: async () => {
      const n = ++calls;
      if (n === 1) throw new Error('临时失败');
      if (n === 3) await gate;
      return { status: 200, body: `DOMAIN,v${n}.test` };
    } });
    const read = (refresh = false) => h.api.post('/api/rulesets/source', { source: remote, refresh });
    expect((await read()).json.status.ok).toBe(false);
    expect((await read()).json.content).toBe('DOMAIN,v2.test');
    const a = read(true); const b = read(true);
    // 两个管理请求进入 getter 后才释放上游，验证同一在途 Promise 的复用。
    await new Promise(resolve => setTimeout(resolve, 20)); release();
    expect((await a).json.content).toBe('DOMAIN,v3.test');
    expect((await b).json.content).toBe('DOMAIN,v3.test');
    expect(calls).toBe(3);
    expect(h.store.latestSnapshot('ruleset', 'r', remote.url!)).toBeUndefined();
  });

  it('缺失有效范围内的正文时拒绝转换，停用来源和二进制不误拦截', async () => {
    const h = await fixture({ id: 'r', name: '缺失', sources: [remote] });
    const convert = (sources: RuleSetSource[], sourceId?: string) => h.api.post('/api/rules/convert', { inputs: sources.map(source => ({ source })), client: 'mihomo', sourceId });
    expect((await convert([remote])).status).toBe(400);
    expect((await convert([{ ...remote, enabled: false }])).status).toBe(200);
    expect((await convert([{ ...remote, enabled: false }], remote.id)).status).toBe(400);
    expect((await convert([{ ...remote, format: 'mrs', behavior: 'domain' }])).status).toBe(200);
    expect((await h.api.post('/api/rulesets/source', { source: remote, refresh: 'true' })).status).toBe(400);
  });
});
