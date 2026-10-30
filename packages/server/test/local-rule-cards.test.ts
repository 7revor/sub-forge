import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { setupApp, addUser, client } from './helpers.ts';
import { setupRuleReferences } from './rule-reference-fixture.ts';
const direct = { kind: 'builtin', name: 'DIRECT' };
const content = '# 本地多条\nDOMAIN,a.test\n\nIP-CIDR,198.51.100.0/24,no-resolve\nDOMAIN,a.test';
const rules = [{ id: 'local', matcher: { kind: 'local', content }, target: direct }];

describe('统一规则卡片服务契约', () => {
  it('模板、独立订阅、绑定前置规则保存重读及 Mihomo/Stash 输出保持组内顺序', async () => {
    const h = setupApp();
    try {
      await addUser(h.store, 'admin', 'admin'); const c = client(h.app); await c.login('admin');
      const template = await c.post('/api/templates', { name: '多条本地规则', groups: [], rules, final: direct });
      expect(template.status, template.text).toBe(201);
      expect(template.json.item.rules).toEqual(rules);
      for (const routing of [{ mode: 'independent', config: { groups: [], rules, final: direct } }, { mode: 'bound', templateId: template.json.item.id, groupAdditions: {}, prependRules: [{ ...rules[0], id: 'prepend' }] }]) {
        const created = await c.post('/api/profiles', { name: '多条规则订阅', nodeSets: [], overlay: {}, chains: [], routing });
        expect(created.status, created.text).toBe(201);
        for (const client of ['mihomo', 'stash'] as const) {
          const result = await h.renderer.render(created.json.item.id, { client });
          expect(result.ok).toBe(true);
          if (!result.ok) throw new Error(result.message);
          const lines = ['DOMAIN,a.test,DIRECT', 'IP-CIDR,198.51.100.0/24,DIRECT,no-resolve', 'DOMAIN,a.test,DIRECT'];
          expect(parse(result.render.yaml).rules).toEqual([...(routing.mode === 'bound' ? [...lines, ...lines] : lines), 'MATCH,DIRECT']);
        }
      }
      for (const bad of ['', '# 注释', 'DOMAIN,a\u2028DOMAIN,b']) {
        expect((await c.post('/api/templates', { name: '无效', groups: [], rules: [{ ...rules[0], matcher: { kind: 'local', content: bad } }], final: direct })).status).toBe(400);
      }
    } finally { await h.snapshots.settled(); h.store.close(); }
  });
  it('替换关联来源使用新身份并保持原位置，仍拒绝伪造关联', async () => {
    const h = await setupRuleReferences();
    try {
      const google = await h.resolve();
      const other = await h.admin.post('/api/rule-options/resolve', { source: 'repository', repo: 'blackmatrix7', entry: 'OpenAI', file: { ref: 'master', path: 'rule/Surge/OpenAI/OpenAI.list' } });
      expect(other.status).toBe(200);
      const created = await h.admin.post('/api/rulesets', { name: '替换来源', sources: [google.repository.sources[0], { id: 'local', kind: 'local', format: 'auto', content }] });
      const doc = created.json.item;
      const sources = [{ ...other.json.matcher.repository.sources[0], id: 'replacement' }, doc.sources[1]];
      const saved = await h.admin.put(`/api/rulesets/${doc.id}`, { ...doc, sources });
      expect(saved.status, saved.text).toBe(200);
      expect(saved.json.item.sources).toEqual(sources);
      expect((await h.admin.put(`/api/rulesets/${doc.id}`, { ...doc, sources: [{ ...sources[0], url: 'https://invalid.test/list' }, sources[1]] })).status).toBe(400);
    } finally { await h.stop(); }
  });
});
