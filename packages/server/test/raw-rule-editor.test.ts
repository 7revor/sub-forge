import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { addUser, client, setupApp } from './helpers.ts';

const raw = (text: string) => ({ type: 'RAW', text });
const direct = { kind: 'builtin', name: 'DIRECT' };
const entry = (id: string, text: string) => ({ id, matcher: { kind: 'rule', rule: raw(text) }, target: direct });
const profile = (extraRules: unknown[]) => ({ name: 'RAW 订阅', nodeSets: [], chains: [], overlay: { extraRules } });
const template = (text: string) => ({ name: 'RAW 模板', groups: [], rules: [entry('t-raw', text)], final: direct });
const ruleset = (text: string) => ({ name: 'RAW 改写', sources: [{ id: 's', kind: 'local', content: 'PROCESS-PATH-WILDCARD,/Apps/*' }], overrides: [{ override: { when: { client: 'mihomo' }, action: { append: [raw(text)] } } }] });

describe('三个入口的 RAW 保存及输出', () => {
  it('模板发布与订阅保存可使用自定义及逻辑 RAW，出口与选项顺序正确', async () => {
    const h = setupApp();
    try {
      await addUser(h.store, 'admin', 'admin'); const c = client(h.app); await c.login('admin');
      const text = 'AND,((DOMAIN,example.test),(NETWORK,tcp))';
      const published = await c.post('/api/templates/new/publish', template(text));
      expect(published.status).toBe(201);
      expect(published.json.item.rules[0].matcher.rule).toEqual(raw(text));
      const created = await c.post('/api/profiles', { ...profile([{ anchor: 'top', rule: entry('private-raw', 'IP-SUFFIX,8.8.8.8/24,no-resolve,src') }]), template: { id: published.json.item.id, follow: 'latest' } });
      expect(created.status).toBe(201);
      const id = created.json.item.id;
      const saved = (await c.get(`/api/profiles?id=${id}`)).json.item;
      expect(saved.routing.mode).toBe('independent');
      expect(saved.routing.config.rules.find((rule: { id: string }) => rule.id === 'private-raw').matcher.rule).toEqual(raw('IP-SUFFIX,8.8.8.8/24,no-resolve,src'));
      const rendered = await h.renderer.render(id, { client: 'mihomo' });
      expect(rendered.ok).toBe(true);
      if (!rendered.ok) throw new Error(rendered.message);
      expect(parse(rendered.render.yaml).rules).toEqual([
        'IP-SUFFIX,8.8.8.8/24,DIRECT,no-resolve,src', `${text},DIRECT`, 'MATCH,DIRECT',
      ]);
      const bound = await c.post('/api/profiles', { name: 'RAW 绑定', nodeSets: [], chains: [], overlay: {}, routing: { mode: 'bound', templateId: published.json.item.id, groupAdditions: {} }, templateVersion: 1 });
      expect(bound.status).toBe(201);
      const boundOutput = await h.renderer.render(bound.json.item.id, { client: 'mihomo' });
      expect(boundOutput.ok).toBe(true);
      if (boundOutput.ok) expect(parse(boundOutput.render.yaml).rules).toEqual([`${text},DIRECT`, 'MATCH,DIRECT']);
    } finally { await h.snapshots.settled(); h.store.close(); }
  });
  it('规则增强 RAW 追加可保存重读，与结构化来源的 wildcard 跨大小写去重', async () => {
    const h = setupApp();
    try {
      await addUser(h.store, 'alice'); const c = client(h.app); await c.login('alice');
      const draft = ruleset('PROCESS-PATH-WILDCARD,/apps/*');
      const preview = await c.post('/api/rulesets/preview', { ruleset: draft, client: 'mihomo' });
      expect(preview.status).toBe(200);
      expect(preview.json.lines.filter((line: string) => line && !line.startsWith('#'))).toEqual(['PROCESS-PATH-WILDCARD,/Apps/*']);
      const created = await c.post('/api/rulesets', draft);
      expect(created.status).toBe(201);
      expect((await c.get(`/api/rulesets?id=${created.json.item.id}`)).json.item.overrides).toEqual(draft.overrides);
      const custom = ruleset('FUTURE,a,b,c');
      const customPreview = await c.post('/api/rulesets/preview', { ruleset: custom, client: 'mihomo' });
      expect(customPreview.status).toBe(200);
      expect(customPreview.json.lines).toContain('FUTURE,a,b,c');
    } finally { await h.snapshots.settled(); h.store.close(); }
  });
  it.each(['', 'DOMAIN,a.test\nDOMAIN,b.test'])('三个入口拒绝空白或多行 RAW：%j', async text => {
    const h = setupApp();
    try {
      await addUser(h.store, 'admin', 'admin'); const c = client(h.app); await c.login('admin');
      expect((await c.post('/api/templates/new/publish', template(text))).status).toBe(400);
      expect((await c.post('/api/profiles', profile([{ anchor: 'top', rule: entry('bad', text) }]))).status).toBe(400);
      expect((await c.post('/api/profiles', { name: 'RAW 独立', nodeSets: [], chains: [], overlay: {}, routing: { mode: 'independent', config: { groups: [], rules: [entry('bad', text)], final: direct } } })).status).toBe(400);
      expect((await c.post('/api/rulesets', ruleset(text))).status).toBe(400);
    } finally { await h.snapshots.settled(); h.store.close(); }
  });
});
