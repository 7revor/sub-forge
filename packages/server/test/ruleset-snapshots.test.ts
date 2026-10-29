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
  env.store.put('ruleset', { id: 'r', name: '远程规则', sources: [{ id: 's1', kind: 'remote', format, url: 'https://rules.example.test/list' }] });
  env.store.put('profile', {
    id: 'p', name: '测试订阅', nodeSets: [], chains: [], refPolicy: { default: 'wrap' },
    overlay: { extraRules: [{ anchor: 'top', rule: { id: 'rule', matcher: { kind: 'ruleset', id: 'r' }, target: { kind: 'builtin', name: 'REJECT' } } }] },
  });
  env.store.putToken({ token: 'test-token', profileId: 'p' });
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
    expect(Object.keys(before.render.rulesets)).toHaveLength(1);
    expect((await h.refresh(invalid)).ok).toBe(false);
    expect(h.store.latestSnapshot('ruleset', 'r', 'https://rules.example.test/list')?.body).toBe(valid);
    const after = await h.renderer.render('p', { client: 'mihomo' });
    expect(after.ok).toBe(true);
    if (!after.ok) throw new Error(after.message);
    expect(after.render.yaml).toBe(before.render.yaml);
    expect(after.render.rulesets).toEqual(before.render.rulesets);
    expect(after.report).toContainEqual(expect.objectContaining({ code: 'ruleset.fetch-failed', level: 'warn' }));
  });

  it('首次收到错误页面时返回 503，不生成只有兜底规则的成功配置', async () => {
    const h = setup('auto', '<html>Not available</html>');
    expect((await h.app.request('/sub/test-token')).status).toBe(503);
    expect(h.store.getLastGood('p', 'mihomo:any')).toBeUndefined();
  });

  it('部分行无法解析仍保留有效规则，并允许之后恢复正常更新', async () => {
    const h = setup('classical', 'DOMAIN,valid.example.test\nUNKNOWN,value');
    const before = await h.renderer.render('p', { client: 'mihomo' });
    expect(before.ok && before.render.rulesets.rs_r_domain).toBe('valid.example.test\n');
    expect(before.report).toContainEqual(expect.objectContaining({ code: 'ruleset.rejected-lines' }));
    expect((await h.refresh('<html>error</html>')).ok).toBe(false);
    expect((await h.refresh('DOMAIN,recovered.example.test')).ok).toBe(true);
    const after = await h.renderer.render('p', { client: 'mihomo' });
    expect(after.ok && after.render.rulesets.rs_r_domain).toBe('recovered.example.test\n');
  });

  it.each([false, true])('历史库中已存在错误快照时保护主配置（已有成功配置：%s）', async hasLastGood => {
    const h = setup('classical', 'DOMAIN,valid.example.test');
    const before = hasLastGood ? await h.renderer.render('p', { client: 'mihomo' }) : undefined;
    h.advance(1000);
    const body = '<html>旧版本错误保存的页面</html>';
    h.store.addSnapshot({ ownerKind: 'ruleset', ownerId: 'r', url: 'https://rules.example.test/list', fetchedAt: 1_700_000_001_000, ok: true, body, hash: stableHash(body) });
    const after = await h.renderer.render('p', { client: 'mihomo' });
    expect(after.report).toContainEqual(expect.objectContaining({ code: 'ruleset.invalid-content', level: 'error' }));
    if (hasLastGood) {
      expect(after.ok && after.source).toBe('last-good');
      expect(after.ok && after.render.yaml).toBe(before?.ok && before.render.yaml);
    } else {
      expect(after.ok).toBe(false);
      expect(h.store.getLastGood('p', 'mihomo:any')).toBeUndefined();
    }
  });

  it('有效规则被客户端覆盖全部丢弃时仍允许输出', async () => {
    const h = setup('classical', 'DOMAIN,valid.example.test');
    const rs = h.store.get('ruleset', 'r')!;
    h.store.put('ruleset', { ...rs, sources: [{ ...rs.sources[0]!, overrides: [{ line: 1, override: { when: { client: 'mihomo' }, action: { drop: true } } }] }] });
    expect((await h.app.request('/sub/test-token')).status).toBe(200);
  });
});
