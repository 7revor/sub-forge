import { ruleBodies } from './helpers.ts';
import { afterEach, describe, expect, it } from 'vitest';
import type { Matcher } from '@sub-forge/core';
import { setupRuleReferences } from './rule-reference-fixture.ts';
import { client } from './helpers.ts';
import { repositoryMatcher } from '../src/ruleset-reference.ts';
import { parse } from 'yaml';

const envs: Awaited<ReturnType<typeof setupRuleReferences>>[] = [];
afterEach(async () => { for (const env of envs.splice(0)) await env.stop(); });
const setup = async () => { const h = await setupRuleReferences(); envs.push(h); return h; };
const template = (matcher: Matcher) => ({ name: '引用验收', groups: [], rules: [{ id: 'r', matcher, target: { kind: 'builtin', name: 'REJECT' } }], final: { kind: 'builtin', name: 'DIRECT' } });

describe('模板统一规则引用', () => {
  it('平级搜索同名候选，精确匹配优先，分页不重不漏，公共规则增强跨用户可见', async () => {
    const h = await setup();
    for (let i = 0; i < 35; i++) h.store.put('ruleset', { id: `more-${i}`, name: `Google ${i}`, sources: [] }, h.user.id);
    const first = await h.admin.get('/api/rule-options/search?q=google&limit=30');
    const second = await h.admin.get('/api/rule-options/search?q=google&limit=30&offset=30');
    expect(first.json.total).toBe(38);
    expect(first.json.items.slice(0, 2).map((x: { label: string }) => x.label).sort()).toEqual(['Google.list', '本地 · Google']);
    const all = [...first.json.items, ...second.json.items];
    expect(new Set(all.map(x => x.value)).size).toBe(38);
    expect(all.some(x => x.label.includes('私有'))).toBe(true);
    expect((await h.admin.post('/api/rule-options/resolve', { source: 'local', id: 'private-google' })).status).toBe(200);
    expect((await h.admin.post('/api/templates/new/publish', template({ kind: 'ruleset', id: 'private-google' }))).status).toBe(201);
    expect((await client(h.app).get('/api/rule-options/search')).status).toBe(401);
    expect((await h.admin.get('/api/rule-options/search?offset=-1')).status).toBe(400);
  });

  it('仓库搜索作用域不混入本地，未就绪索引和无结果分别返回', async () => {
    const h = await setup();
    expect((await h.admin.get('/api/rule-options/search?q=google&scope=repository')).json.items).toHaveLength(1);
    h.repos.setEnabled('zydou', true);
    const missing = await h.admin.get('/api/rule-options/search?q=不存在');
    expect(missing.json.items).toEqual([]);
    expect(missing.json.notices.join()).toContain('索引尚未就绪');
  });

  it('选择不落本地库，引用身份稳定；发布、渲染与资源输出闭环', async () => {
    const h = await setup();
    const matcher = await h.resolve();
    expect(await h.resolve()).toEqual(matcher);
    expect(h.store.list('ruleset')).toHaveLength(2);
    const draft = template(matcher);
    const published = await h.admin.post('/api/templates/new/publish', { ...draft, rules: draft.rules.map(r => ({ ...r, options: { src: true } })) });
    expect(published.status).toBe(201);
    h.store.put('profile', { id: 'p', name: '引用配置', nodeSets: [], overlay: {}, chains: [], refPolicy: { default: 'wrap' }, template: { id: published.json.item.id, follow: 'latest' } }, h.user.id);
    const rendered = await h.renderer.render('p', { client: 'mihomo' });
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const config = parse(rendered.render.yaml);
    expect(Object.keys(config['rule-providers'])).toEqual(['Google']);
    expect(config.rules).toContain('RULE-SET,Google,REJECT');
    expect(Object.values(ruleBodies(h.store, rendered.render)).join('\n')).toContain('google.example.test');
    expect(h.store.list('ruleset')).toHaveLength(2);
    expect((await h.admin.del('/api/rule-repos/blackmatrix7')).status).toBe(409);
  });

  it('停用或移除仓库资源后保留编辑定义，但发布、渲染与新选择均拒绝失效引用', async () => {
    const h = await setup(); const matcher = await h.resolve();
    const first = await h.admin.post('/api/templates/new/publish', template(matcher));
    h.repos.setEnabled('blackmatrix7', false);
    h.store.db.prepare('DELETE FROM rule_repo_entries WHERE repo = ?').run('blackmatrix7');
    expect((await h.admin.post('/api/templates/validate', { ...template(matcher), id: first.json.item.id })).json.report).toContainEqual(expect.objectContaining({ level: 'error', code: 'template.dangling-ruleset' }));
    expect((await h.admin.post(`/api/templates/${first.json.item.id}/publish`, template(matcher))).status).toBe(400);
    expect((await h.admin.post('/api/rule-options/resolve', { source: 'repository', repo: 'blackmatrix7', entry: 'Google' })).status).toBe(404);
    const preview = await h.renderer.previewDraft({ id: '', name: '草稿', nodeSets: [], overlay: {}, chains: [], refPolicy: { default: 'wrap' }, template: { id: first.json.item.id, follow: 'latest' } }, { client: 'mihomo' });
    expect(preview.ok).toBe(false);
  });

  it('伪造 URL、格式或身份均阻止发布，错误可定位到规则行', async () => {
    const h = await setup(); const matcher = await h.resolve();
    for (const change of ['url', 'format', 'identity', 'extra']) {
      const forged = structuredClone(matcher);
      if (change === 'url') forged.repository.sources[0].url = 'https://evil.example.test/rules';
      if (change === 'format') forged.repository.sources[0].format = 'classical';
      if (change === 'extra') forged.repository.sources[0].repository.unknown = '无效';
      const input = change === 'identity' ? { ...forged, id: 'local-google' } : repositoryMatcher(forged.repository);
      const res = await h.admin.post('/api/templates/new/publish', template(input));
      expect(res.status).toBe(400);
      expect(res.json.details.report).toContainEqual(expect.objectContaining({ where: 'rule:r', code: 'template.ruleset-reference' }));
    }
    expect(h.calls).toEqual([]);
  });

  it('上游不可解析时禁止发布并定位，禁用规则不触发上游请求', async () => {
    const h = await setup(); const matcher = await h.resolve(); h.setBody('<html>错误页面</html>');
    const invalid = await h.admin.post('/api/templates/new/publish', template(matcher));
    expect(invalid.status).toBe(400);
    expect(invalid.json.details.report).toContainEqual(expect.objectContaining({ where: 'rule:r', code: 'template.ruleset-unavailable' }));
    h.calls.length = 0;
    const disabled = template(matcher);
    const result = await h.admin.post('/api/templates/new/publish', { ...disabled, rules: disabled.rules.map(r => ({ ...r, enabled: false })) });
    expect(result.status).toBe(201);
    expect(h.calls).toEqual([]);
  });

  it('旧本地引用继续发布，内容定制留在本地规则集；私有规则也能引用仓库', async () => {
    const h = await setup();
    expect((await h.admin.post('/api/templates/new/publish', template({ kind: 'ruleset', id: 'local-google' }))).status).toBe(201);
    const matcher = await h.resolve();
    const profile = await h.admin.post('/api/profiles', { name: '私有引用', nodeSets: [], overlay: { extraRules: [{ anchor: 'top', rule: template(matcher).rules[0] }] } });
    expect(profile.status).toBe(201);
    const preview = await h.renderer.preview(profile.json.item.id, { client: 'mihomo' });
    expect(preview.ok).toBe(true);
  });
});
