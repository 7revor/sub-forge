import { describe, expect, it } from 'vitest';
import { addUser, client, setupApp } from './helpers.ts';

const content = '# 规则\nDOMAIN,a.test\nUNKNOWN,x*\nPROCESS-NAME,Example\nDOMAIN,last.test';
const remote = { id: 'a', kind: 'remote', format: 'auto', url: 'https://rules.example.test/list' };
async function scenario() {
  const calls: { url: string; ua?: string }[] = [];
  const env = setupApp({ fetcher: async (url, opts) => { calls.push({ url, ua: opts?.ua }); return { status: 200, body: content }; } });
  await addUser(env.store, 'alice'); await addUser(env.store, 'bob');
  const alice = client(env.app); const bob = client(env.app);
  await alice.login('alice'); await bob.login('bob');
  return { ...env, alice, bob, calls };
}
describe('来源获取与服务端转换分离', () => {
  it('USER-AGENT 来源统计正常，四客户端转换和 GET 下载按能力输出', async () => {
    const env = setupApp({ fetcher: async () => ({ status: 200, body: 'USER-AGENT,PayPal*' }) });
    try {
      await addUser(env.store, 'alice'); const alice = client(env.app); await alice.login('alice');
      const loaded = await alice.post('/api/rulesets/source', { source: remote });
      expect(loaded.status).toBe(200);
      expect(loaded.json.status).toMatchObject({ rules: 1, rejected: 0 });
      for (const [target, platform] of [['mihomo', undefined], ['mihomo', 'android'], ['surge', 'macos'], ['surge', 'ios']]) {
        const result = await alice.post('/api/rules/convert', { inputs: [{ source: remote, content: loaded.json.content }], client: target, platform });
        expect(result.status).toBe(200);
        expect(result.json.stats).toMatchObject({ parsed: 1, rejected: 0, output: target === 'surge' ? 1 : 0, unsupported: target === 'surge' ? 0 : 1 });
        expect(result.json.lines).toEqual(target === 'surge' ? ['USER-AGENT,PayPal*'] : ['# [mihomo 不支持 USER-AGENT] USER-AGENT,PayPal*']);
        const downloaded = await alice.get(`/api/rules/convert?url=${encodeURIComponent(remote.url)}&target=${target}${platform ? `&platform=${platform}` : ''}`);
        expect(downloaded.status).toBe(target === 'surge' ? 200 : 400);
        if (target === 'surge') {
          expect(downloaded.text).toBe('USER-AGENT,PayPal*\n');
          expect(downloaded.headers.get('x-rule-count')).toBe('1');
          expect(downloaded.headers.get('x-rule-rejected')).toBe('0');
        }
      }
      const overridden = await alice.post('/api/rules/convert', { inputs: [{ source: remote, content: loaded.json.content }], client: 'surge', overrides: [{ override: { when: { client: 'surge' }, action: { append: [{ type: 'USER-AGENT', value: 'Other*' }] } } }] });
      expect(overridden.status).toBe(200);
      expect(overridden.json.lines).toEqual(['USER-AGENT,PayPal*', 'USER-AGENT,Other*']);
    } finally { await env.snapshots.settled(); env.store.close(); }
  });

  it('客户端转换不拉取上游，未解析诊断与客户端诊断独立，来源按读取参数缓存', async () => {
    const { alice, calls } = await scenario();
    const loaded = await alice.post('/api/rulesets/source', { source: remote });
    expect(loaded.status).toBe(200);
    expect(loaded.json.content).toBe(content);
    expect(loaded.json.status).toMatchObject({ rules: 3, rejected: 1 });
    const body = { inputs: [{ source: remote, content: loaded.json.content }], client: 'mihomo' };
    const mihomo = await alice.post('/api/rules/convert', body);
    const ios = await alice.post('/api/rules/convert', { ...body, client: 'surge', platform: 'ios' });
    expect(mihomo.status).toBe(200); expect(ios.status).toBe(200);
    expect(mihomo.json.lines).toHaveLength(ios.json.lines.length);
    expect(ios.json.lines[3]).toContain('Surge iOS 不支持进程规则');
    expect(ios.json.stats).toMatchObject({ rejected: 1, unsupported: 1, output: 2 });
    expect(calls).toHaveLength(1);
    await alice.post('/api/rulesets/source', { source: { ...remote, name: '重命名' } });
    expect(calls).toHaveLength(2);
    await alice.post('/api/rulesets/source', { source: { ...remote, fetch: { ua: 'different' } } });
    expect(calls).toHaveLength(3);
    expect(calls[2]!.ua).toBe('different');
  });

  it('已保存公共来源跨用户可读，未保存草稿不落快照', async () => {
    const { alice, bob, store, calls } = await scenario();
    const saved = await alice.post('/api/rulesets', { name: '示例', sources: [remote] });
    const id = saved.json.item.id;
    expect((await bob.get(`/api/rulesets/sources/content?id=${id}&source=a`)).status).toBe(200);
    expect((await bob.post('/api/rulesets/source', { id, source: remote })).status).toBe(200);
    expect((await alice.get(`/api/rulesets/sources/content?id=${id}&source=a`)).json.content).toBe(content);
    expect(store.latestSnapshot('ruleset', id, remote.url)?.body).toBe(content);
    await alice.post('/api/rulesets/source', { source: remote });
    await bob.post('/api/rulesets/source', { source: remote });
    expect(calls).toHaveLength(3);
  });

  it('畸形内容可诊断，恶意转换参数返回 400，转换不会根据 URL 自动下载', async () => {
    const { alice, calls } = await scenario();
    const loaded = await alice.post('/api/rulesets/source', { source: { id: 'a', kind: 'local', format: 'auto', content: 'payload: [' } });
    expect(loaded.status).toBe(200); expect(loaded.json.status.rejected).toBe(1);
    expect((await alice.post('/api/rules/convert', { inputs: [{ source: remote }], client: 'mihomo' })).status).toBe(400);
    expect(calls).toHaveLength(0);
    expect((await alice.post('/api/rules/convert', { inputs: [{ source: remote }], client: 'bad' })).status).toBe(400);
    expect((await alice.post('/api/rules/convert', { inputs: [{ source: remote }, { source: remote }], client: 'mihomo' })).status).toBe(400);
    expect((await alice.post('/api/rules/convert', { inputs: [{ source: remote }], client: 'mihomo', overrides: [{ override: {} }] })).status).toBe(400);
  });
  it('纯未支持或畸形远程原文仍返回，来源诊断不因客户端改变', async () => {
    const env = setupApp({ fetcher: async () => ({ status: 200, body: 'UNKNOWN,x*\nDOMAIN,' }) });
    try {
      await addUser(env.store, 'alice'); const alice = client(env.app); await alice.login('alice');
      const loaded = await alice.post('/api/rulesets/source', { source: remote });
      expect(loaded.json.content).toBe('UNKNOWN,x*\nDOMAIN,');
      expect(loaded.json.status).toMatchObject({ rules: 0, rejected: 2 });
      const result = await alice.post('/api/rules/convert', { inputs: [{ source: remote, content: loaded.json.content }], client: 'surge', platform: 'ios' });
      expect(result.json.lines).toHaveLength(2);
      expect(result.json.lines.every((line: string) => line.startsWith('#'))).toBe(true);
      expect(result.json.stats).toMatchObject({ rejected: 2, unsupported: 0 });
    } finally { await env.snapshots.settled(); env.store.close(); }
  });

  it('GET、草稿读取和转换均要求登录，非法旧改写不会造成 500', async () => {
    const { app, alice } = await scenario();
    const anonymous = client(app);
    expect((await anonymous.get('/api/rulesets/sources/content?id=unknown&source=a')).status).toBe(401);
    expect((await anonymous.post('/api/rulesets/source', { source: remote })).status).toBe(401);
    expect((await anonymous.post('/api/rules/convert', { inputs: [], client: 'mihomo' })).status).toBe(401);
    expect((await alice.post('/api/rules/convert', { inputs: [{ source: { ...remote, overrides: [{ line: 1, override: { action: 'invalid' } }] } }], client: 'mihomo' })).status).toBe(400);
  });

});
