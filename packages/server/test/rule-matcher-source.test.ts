import { afterEach, describe, expect, it } from 'vitest';
import { remoteRuleMatcher } from '@sub-forge/core';
import { setupRuleReferences } from './rule-reference-fixture.ts';
import { addUser, client, setupApp } from './helpers.ts';

const envs: Awaited<ReturnType<typeof setupRuleReferences>>[] = [];
afterEach(async () => { for (const env of envs.splice(0)) await env.stop(); });
const setup = async () => { const h = await setupRuleReferences(); envs.push(h); return h; };
const path = '/api/rules/matcher-source';

describe('规则引用完整源文件预览', () => {
  it('远程原文完整保留注释、空行、未识别规则及末尾，不截取前若干行', async () => {
    const h = await setup();
    const content = '# 原文注释\r\n\r\n' + Array.from({ length: 1200 }, (_, i) => `DOMAIN,rule-${i}.test`).join('\r\n') + '\r\n未知规则\r\n';
    h.setBody(content);
    const matcher = remoteRuleMatcher('https://example.test/rules.list');
    const result = await h.admin.post(path, { matcher });
    expect(result.status, result.text).toBe(200);
    expect(result.json).toEqual({ name: matcher.remote!.url, content, sources: 1 });
    expect(h.store.list('ruleset')).toHaveLength(2);
  });

  it('本地多来源按顺序合并原文，不转换 YAML、不去重、不应用客户端改写', async () => {
    const h = await setup();
    const first = '# 原始 YAML\npayload:\n  - duplicate.test\n';
    const second = '# 第二来源\nDOMAIN,duplicate.test\n不支持的原文\n';
    h.store.put('ruleset', { id: 'merged', name: '多源规则', sources: [
      { id: 'one', kind: 'local', format: 'auto', content: first },
      { id: 'two', kind: 'local', format: 'auto', content: second },
    ], overrides: [{ match: 'DOMAIN,duplicate.test', override: { when: { client: 'mihomo' }, action: { drop: true } } }] }, h.user.id);
    const result = await h.admin.post(path, { matcher: { kind: 'ruleset', id: 'merged' } });
    expect(result.status, result.text).toBe(200);
    expect(result.json).toEqual({ name: '多源规则', content: first + '\n' + second, sources: 2 });
  });

  it('仓库引用预览所选映射全部来源，不创建本地规则集', async () => {
    const h = await setup();
    const matcher = await h.resolve();
    const content = '# 仓库原文\nDOMAIN,repository.test\n'; h.setBody(content);
    const result = await h.admin.post(path, { matcher });
    expect(result.status, result.text).toBe(200);
    expect(result.json.content).toBe(matcher.repository.sources.map(() => content).join('\n'));
    expect(result.json.sources).toBe(matcher.repository.sources.length);
    expect(h.store.list('ruleset')).toHaveLength(2);
  });

  it('先检查登录与规则引用权限，公共规则集可读，其他用户创建的规则增强也可读', async () => {
    const h = await setup(); const anonymous = client(h.app);
    const publicMatcher = { kind: 'ruleset', id: 'local-google' };
    expect((await anonymous.post(path, { matcher: publicMatcher })).status).toBe(401);
    const reader = client(h.app); await reader.login('reference-user');
    expect((await reader.post(path, { matcher: publicMatcher })).json.content).toBe('DOMAIN,local.example.test');
    expect((await h.admin.post(path, { matcher: { kind: 'ruleset', id: 'private-google' } })).status).toBe(200);
    for (const matcher of [null, [], {}, { kind: 'rule' }, { kind: 'ruleset' }, { kind: 'ruleset', id: 'missing' }]) {
      expect((await h.admin.post(path, { matcher })).status).toBeGreaterThanOrEqual(400);
    }
    const forged = await h.resolve(); forged.repository.sources[0].url = 'https://evil.test/rules.list';
    expect((await h.admin.post(path, { matcher: forged })).status).toBe(400);
    expect(h.calls).toEqual([]);
  });

  it('读取失败不返回部分预览，重试成功；空文件仍能预览', async () => {
    let failing = true;
    const h = setupApp({ fetcher: async () => {
      if (failing) throw new Error('模拟读取失败');
      return { status: 200, body: '' };
    } });
    try {
      const user = await addUser(h.store, 'preview-admin', 'admin');
      const api = client(h.app); await api.login('preview-admin');
      h.store.put('ruleset', { id: 'failure', name: '失败来源', sources: [
        { id: 'good', kind: 'local', format: 'auto', content: 'DOMAIN,good.test' },
        { id: 'bad', kind: 'remote', format: 'auto', url: 'https://example.test/bad.list' },
      ] }, user.id);
      const matcher = { kind: 'ruleset', id: 'failure' };
      const failed = await api.post(path, { matcher });
      expect(failed.status).toBe(502); expect(failed.json).not.toHaveProperty('content');
      failing = false;
      expect((await api.post(path, { matcher })).json.content).toBe('DOMAIN,good.test\n');
      const empty = await api.post(path, { matcher: remoteRuleMatcher('https://example.test/empty.list') });
      expect(empty.status).toBe(200); expect(empty.json.content).toBe('');
      h.store.put('ruleset', { id: 'binary', name: '二进制', sources: [{ id: 'binary', kind: 'remote', format: 'mrs', url: 'https://example.test/rules.mrs' }] }, user.id);
      const binary = await api.post(path, { matcher: { kind: 'ruleset', id: 'binary' } });
      expect(binary.status).toBe(400); expect(binary.json.error).toContain('二进制');
    } finally { await h.snapshots.settled(); h.store.close(); }
  });
});
