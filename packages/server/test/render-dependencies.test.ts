import { afterEach, describe, expect, it } from 'vitest';
import type { Overlay, RuleEntry, Template } from '@sub-forge/core';
import { setupApp } from './helpers.ts';

const envs: ReturnType<typeof setupApp>[] = [];
afterEach(async () => {
  for (const env of envs.splice(0)) { await env.snapshots.settled(); env.store.close(); }
});

const rule: RuleEntry = { id: 'r', matcher: { kind: 'ruleset', id: 'bad' }, target: { kind: 'builtin', name: 'REJECT' } };
const template: Template = { id: 't', version: 1, groups: [], rules: [rule], final: { kind: 'builtin', name: 'DIRECT' } };
function setup(overlay: Overlay, tpl?: Template) {
  const calls: string[] = [];
  const h = setupApp({ fetcher: async url => { calls.push(url); throw new Error('模拟远程规则不可用'); } });
  envs.push(h);
  h.store.put('ruleset', { id: 'bad', name: '不可用规则', kind: 'remote', format: 'classical', url: 'https://rules.example.test/bad' });
  if (tpl) h.store.putTemplateVersion(tpl);
  h.store.put('profile', { id: 'p', name: '测试', nodeSets: [], chains: [], refPolicy: { default: 'wrap' }, overlay, ...(tpl ? { template: { id: tpl.id, follow: 'latest' as const } } : {}) });
  h.store.putToken({ token: 'token', profileId: 'p' });
  return { ...h, calls };
}

describe('仅拉取实际启用的规则依赖', () => {
  it.each<[string, Overlay, Template | undefined]>([
    ['私有规则禁用', { extraRules: [{ anchor: 'top', rule: { ...rule, enabled: false } }] }, undefined],
    ['模板规则禁用', {}, { ...template, rules: [{ ...rule, enabled: false }] }],
    ['覆盖层禁用模板规则', { rulePatches: { r: { enabled: false } } }, template],
    ['私有规则锚点失效', { extraRules: [{ anchor: { after: 'missing' }, rule }] }, undefined],
  ])('%s 不访问坏上游且订阅仍可用', async (_name, overlay, tpl) => {
    const h = setup(overlay, tpl);
    const res = await h.app.request('/sub/token');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('MATCH,DIRECT');
    expect(h.calls).toEqual([]);
    expect(h.store.snapshotHistory('ruleset', 'bad')).toEqual([]);
  });

  it('规则包只拉取启用子项，保留其他单条规则', async () => {
    const h = setup({ extraRules: [{ anchor: 'top', rule: { ...rule, matcher: { kind: 'bundle', id: 'b' } } }] });
    h.store.put('bundle', { id: 'b', name: '混合规则包', items: [
      { kind: 'ruleset', id: 'bad', enabled: false },
      { kind: 'rule', rule: { type: 'DOMAIN', value: 'active.example.test' } },
    ] });
    const res = await h.renderer.render('p', { client: 'mihomo' });
    expect(res.ok && res.render.rulesets.b_b_domain).toBe('active.example.test\n');
    expect(h.calls).toEqual([]);
  });

  it('覆盖层重新启用模板规则后恢复拉取，失败时不会伪装成功', async () => {
    const h = setup({ rulePatches: { r: { enabled: true } } }, { ...template, rules: [{ ...rule, enabled: false }] });
    expect((await h.app.request('/sub/token')).status).toBe(503);
    expect(h.calls).toEqual(['https://rules.example.test/bad']);
  });

  it('同一规则集仍有启用引用时不能因另一引用禁用而跳过', async () => {
    const h = setup({ extraRules: [
      { anchor: 'top', rule: { ...rule, enabled: false } },
      { anchor: 'bottom', rule: { ...rule, id: 'active' } },
    ] });
    expect((await h.app.request('/sub/token')).status).toBe(503);
    expect(h.calls).toHaveLength(1);
  });
});
