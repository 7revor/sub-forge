import { parse } from 'yaml';
import { ruleBodies } from './helpers.ts';
import { issueProfileToken } from './helpers.ts';
import { afterEach, describe, expect, it } from 'vitest';
import { stableHash, type RuleSetFormat } from '@sub-forge/core';
import { setupApp } from './helpers.ts';

const envs: ReturnType<typeof setupApp>[] = [];
afterEach(async () => {
  for (const env of envs.splice(0)) { await env.snapshots.settled(); env.store.close(); }
});

function setup(format: RuleSetFormat, initial: string) {
  let body = initial;
  const env = setupApp({ fetcher: async () => ({ status: 200, body }) });
  envs.push(env);
  env.store.put('ruleset', { id: 'r', name: '远程规则', overrides: [{ match: 'DOMAIN,unused.fixture.test', override: { when: { client: 'mihomo' as const }, action: { drop: true as const } } }], sources: [{ id: 's1', kind: 'remote', format, url: 'https://rules.example.test/list' }] });
  env.store.put('profile', {
    id: 'p', name: '测试订阅', nodeSets: [], chains: [], refPolicy: { default: 'wrap' },
    overlay: { extraRules: [{ anchor: 'top', rule: { id: 'rule', matcher: { kind: 'ruleset', id: 'r' }, target: { kind: 'builtin', name: 'REJECT' } } }] },
  });
  issueProfileToken(env.store, { token: 'test-token', profileId: 'p' });
  return { ...env, refresh: async (next: string) => {
    body = next; env.advance(1000);
    return env.snapshots.refresh('ruleset', 'r', 'https://rules.example.test/list', { format });
  } };
}

describe('远程规则快照有效性', () => {
  it.each<[RuleSetFormat, string, string]>([
    ['classical', 'DOMAIN,blocked.example.test', '<html>Service unavailable</html>'],
    ['auto', '.blocked.example.test', '<!DOCTYPE html><html>Login</html>'],
    ['domain', '+.blocked.example.test', '{"error":"expired"}'],
    ['domain-set', '.blocked.example.test', 'Service unavailable'],
    ['ipcidr', '192.0.2.0/24', 'not a cidr'],
    ['yaml', 'payload: ["+.blocked.example.test"]', 'payload: ['],
    ['yaml', 'payload: ["+.blocked.example.test"]', 'message: unavailable'],
    ['yaml', 'payload: ["+.blocked.example.test"]', 'payload: [{error: expired}]'],
    ['yaml', 'payload: ["+.blocked.example.test"]', 'payload: []'],
    ['classical', 'DOMAIN,blocked.example.test', 'UNKNOWN,value'],
    ['classical', 'DOMAIN,blocked.example.test', '# unavailable'],
    ['classical', 'DOMAIN,blocked.example.test', ''],
  ])('%s 的无效响应 %s → %s 不覆盖可用快照和订阅资源', async (format, valid, invalid) => {
    const h = setup(format, valid);
    const before = await h.renderer.render('p', { client: 'mihomo' });
    expect(before.ok).toBe(true);
    if (!before.ok) throw new Error(before.message);
    expect(Object.keys((await ruleBodies(h.renderer, 'p')))).toHaveLength(1);
    expect((await h.refresh(invalid)).ok).toBe(false);
    expect(h.store.latestSnapshot('ruleset', 'r', 'https://rules.example.test/list')?.body).toBe(valid);
    const after = await h.renderer.render('p', { client: 'mihomo' });
    expect(after.ok).toBe(true);
    if (!after.ok) throw new Error(after.message);
    expect(after.render.yaml).toBe(before.render.yaml);
    expect((await ruleBodies(h.renderer, 'p'))).toEqual((await ruleBodies(h.renderer, 'p')));
    expect(after.report).toContainEqual(expect.objectContaining({ code: 'ruleset.fetch-failed', level: 'warn' }));
  });

  it('首次收到错误页面时返回 503，不生成只有兜底规则的成功配置', async () => {
    const h = setup('auto', '<html>Not available</html>');
    expect((await h.app.request('/subs/profile?token=test-token&id=p')).status).toBe(503);
  });

  it('部分行无法解析仍保留有效规则，并允许之后恢复正常更新', async () => {
    const h = setup('classical', 'DOMAIN,valid.example.test\nUNKNOWN,value');
    const before = await h.renderer.render('p', { client: 'mihomo' });
    expect(before.ok && (await ruleBodies(h.renderer, 'p'))['rs_r_classical.list']).toBe('DOMAIN,valid.example.test\n# [本系统暂未支持解析：不支持的规则类型 UNKNOWN] UNKNOWN,value\n');
    expect(before.report.some(item => ['ruleset.rejected-lines', 'rule.unimplemented'].includes(item.code))).toBe(false);
    expect((await h.refresh('<html>error</html>')).ok).toBe(false);
    expect((await h.refresh('DOMAIN,recovered.example.test')).ok).toBe(true);
    const after = await h.renderer.render('p', { client: 'mihomo' });
    expect(after.ok && (await ruleBodies(h.renderer, 'p'))['rs_r_classical.list']).toBe('DOMAIN,recovered.example.test\n');
  });

  it('历史库中已存在错误快照时规则文件报错，不下发错误内容', async () => {
    const h = setup('classical', 'DOMAIN,valid.example.test');
    h.advance(1000);
    const body = '<html>旧版本错误保存的页面</html>';
    h.store.addSnapshot({ ownerKind: 'ruleset', ownerId: 'r', url: 'https://rules.example.test/list', fetchedAt: 1_700_000_001_000, ok: true, body, hash: stableHash(body) });
    expect((await h.renderer.render('p', { client: 'mihomo' })).ok).toBe(true);
    await expect(h.renderer.sharedRules.read({ matcher: { kind: 'ruleset', id: 'r' } }, { client: 'mihomo' })).rejects.toThrow('没有可用规则');
    expect((await h.renderer.preview('p', { client: 'mihomo' })).report).toContainEqual(expect.objectContaining({ code: 'ruleset.invalid-content', level: 'error' }));
  });

  it('有效规则被客户端覆盖全部丢弃时仍允许输出', async () => {
    const h = setup('classical', 'DOMAIN,valid.example.test');
    const rs = h.store.get('ruleset', 'r')!;
    h.store.put('ruleset', { ...rs, sources: [{ ...rs.sources[0]!, overrides: [{ line: 1, override: { when: { client: 'mihomo' }, action: { drop: true } } }] }] });
    expect((await h.app.request('/subs/profile?token=test-token&id=p')).status).toBe(200);
  });

  it('规则全部不适用于目标内核时，主配置仍声明 provider，规则文件返回合法的空内容', async () => {
    const h = setup('classical', 'DOMAIN,valid.example.test');
    const rs = h.store.get('ruleset', 'r')!;
    h.store.put('ruleset', { ...rs, sources: [{ ...rs.sources[0]!, overrides: [{ line: 1, override: { when: { client: 'mihomo' }, action: { drop: true } } }] }] });
    const rendered = await h.renderer.render('p', { client: 'mihomo' });
    expect(rendered.ok && parse(rendered.render.yaml).rules[0]).toContain('RULE-SET,');
    const output = await h.renderer.sharedRules.read({ matcher: { kind: 'ruleset', id: 'r' } }, { client: 'mihomo' });
    expect(output?.body.split('\n').filter(line => line && !line.startsWith('#'))).toEqual([]);
  });
});
