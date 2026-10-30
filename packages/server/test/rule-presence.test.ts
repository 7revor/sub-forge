import { issueProfileToken } from './helpers.ts';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderMihomo } from '@sub-forge/core';
import { Cipher } from '../src/crypto.ts';
import type { ProfileDoc, TemplateVersionDoc } from '../src/docs.ts';
import { normalizeRulePresence } from '../src/rule-presence.ts';
import { Store } from '../src/store.ts';
import { addUser, client, setupApp } from './helpers.ts';

const direct = { kind: 'builtin' as const, name: 'DIRECT' as const };
const rule = (id: string, enabled?: boolean) => ({ id, matcher: { kind: 'rule' as const, rule: { type: 'DOMAIN' as const, value: `${id}.test` } }, target: direct, ...(enabled !== undefined ? { enabled } : {}) });
const template: TemplateVersionDoc = { id: 't', name: '模板', version: 1, groups: [], rules: [rule('on', true), rule('off', false)], final: direct };
const base: ProfileDoc = { id: 'p', name: '订阅', nodeSets: [], overlay: {}, chains: [], refPolicy: { default: 'wrap' },
  routing: { mode: 'bound', templateId: 't', groupAdditions: {}, prependRules: [rule('pre-on', true), rule('pre-off', false)] } };

describe('规则存在即生效', () => {
  it('v16 升级移除停用项，渲染、归属、时间、链接、模板内容和历史资源保持一致，重启幂等', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-rule-presence-'));
    const cipher = new Cipher(randomBytes(32));
    const file = join(dir, 'state.sqlite');
    let store = new Store(file, { cipher, now: () => 1234 });
    try {
      const withSources: TemplateVersionDoc = { ...template, rules: [...template.rules, { id: 'set', matcher: { kind: 'ruleset', id: 'rs' }, target: direct }] };
      store.putTemplateVersion(withSources);
      store.putTemplateVersion({ ...withSources, version: 2 });
      store.put('profile', base, 'owner');
      store.put('profile', { ...base, id: 'independent', routing: { mode: 'independent', config: { groups: [], rules: [rule('own-on', true), rule('own-off', false)], final: direct } } }, 'owner');
      store.put('ruleset', { id: 'rs', name: '规则集', sources: [
        { id: 'on', kind: 'local', format: 'auto', content: 'DOMAIN,source-on.test', enabled: true },
        { id: 'off', kind: 'local', format: 'auto', content: 'DOMAIN,source-off.test', enabled: false },
      ] }, 'owner');
      store.put('source', { id: 'nodes', name: '节点源', url: 'https://nodes.test/sub', pipeline: [{ op: 'filter.useless', enabled: false }] }, 'owner');
      issueProfileToken(store, { token: 'same-token', profileId: 'p' });
      const output = (id: string) => renderMihomo({ profile: store.get('profile', id)!, template: store.getTemplate('t'), nodeSets: { sources: {}, collections: {}, locals: {}, snapshots: {} },
        rules: { rulesets: { rs: store.get('ruleset', 'rs')! }, snapshots: {} }, urls: { provider: key => key, ruleset: key => key } }).yaml;
      const before = ['p', 'independent'].map(output);
      store.db.pragma('user_version = 16'); store.close(); store = new Store(file, { cipher, now: () => 9999 });
      expect(store.db.pragma('user_version', { simple: true })).toBe(28);
      expect(['p', 'independent'].map(output)).toEqual(before);
      expect(store.getWithOwner('profile', 'p')).toMatchObject({ owner: 'owner', updatedAt: 1234 });
      expect(store.getToken('same-token')?.userId).toBe(store.getWithOwner('profile', 'p')?.owner);
      expect(store.listLatestTemplates()).toHaveLength(1);
      expect(store.getTemplate('t')).not.toHaveProperty('version');
      expect(store.getTemplate('t')!.rules).toEqual([rule('on'), { id: 'set', matcher: { kind: 'ruleset', id: 'rs' }, target: direct }]);
      expect(store.get('profile', 'p')!.routing).toMatchObject({ prependRules: [rule('pre-on')] });
      expect(store.get('ruleset', 'rs')!.sources).toEqual([{ id: 'on', kind: 'local', format: 'auto', content: 'DOMAIN,source-on.test' }]);
      expect(store.get('source', 'nodes')!.pipeline[0]!.enabled).toBe(false);
      const snapshot = [store.list('profile'), store.list('ruleset'), store.listLatestTemplates()];
      store.close(); store = new Store(file, { cipher });
      expect([store.list('profile'), store.list('ruleset'), store.listLatestTemplates()]).toEqual(snapshot);
    } finally { store.close(); rmSync(dir, { recursive: true }); }
  });

  it('保存、预览、模板自检和发布接受旧字段时移除停用项，其余条目清除标记', async () => {
    const env = setupApp();
    try {
      await addUser(env.store, 'admin', 'admin');
      const user = client(env.app); await user.login('admin');
      const ruleset = await user.post('/api/rulesets', { name: '规则集', sources: [
        { id: 'off', kind: 'remote', url: '非法地址无需拉取', format: 'auto', enabled: false },
        { id: 'on', kind: 'local', content: 'DOMAIN,on.test', format: 'auto', enabled: true },
      ] });
      expect(ruleset.status).toBe(201);
      expect(ruleset.json.item.sources).toEqual([{ id: 'on', kind: 'local', content: 'DOMAIN,on.test', format: 'auto' }]);
      const published = await user.post('/api/templates/new/publish', template);
      expect(published.status).toBe(201);
      expect(published.json.item.rules).toEqual([rule('on')]);
      const profile = { ...base, id: undefined, routing: { ...base.routing, templateId: published.json.item.id } };
      const preview = await user.post('/api/profiles/preview', { profile });
      expect(preview.status).toBe(200);
      expect(preview.json.yaml).toContain('DOMAIN,pre-on.test,DIRECT');
      expect(preview.json.yaml).not.toContain('off.test');
      const saved = await user.post('/api/profiles', profile);
      expect(saved.status).toBe(201);
      expect(saved.json.item.routing.prependRules).toEqual([rule('pre-on')]);
      expect((await user.get(`/api/profiles?id=${saved.json.item.id}`)).json.item.routing.prependRules).toEqual([rule('pre-on')]);
    } finally { await env.snapshots.settled(); env.store.close(); }
  });

  it('种子导入和嵌套仓库映射执行相同清理，旧对象保持完整', () => {
    const source = { id: 's', kind: 'local', format: 'auto', content: 'DOMAIN,a.test' };
    const value = { rules: [{ ...rule('repo', true), matcher: { kind: 'ruleset', id: 'r', repository: { sources: [{ ...source, enabled: true }, { ...source, id: 'off', enabled: false }] } } }] };
    expect(normalizeRulePresence('template', value)).toMatchObject({ rules: [{ matcher: { repository: { sources: [source] } } }] });
    expect(value.rules[0]!.enabled).toBe(true);
    const store = new Store(':memory:');
    try {
      store.importSeed({ templates: [template], profiles: [base] });
      expect(store.getTemplate('t')!.rules).toEqual([rule('on')]);
      expect(store.get('profile', 'p')!.routing).toMatchObject({ prependRules: [rule('pre-on')] });
    } finally { store.close(); }
  });
});
