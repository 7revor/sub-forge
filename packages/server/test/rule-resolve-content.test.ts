import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RuleEntry } from '@sub-forge/core';
import { Cipher } from '../src/crypto.ts';
import { Store } from '../src/store.ts';
import { addUser, client, setupApp } from './helpers.ts';

const direct = { kind: 'builtin' as const, name: 'DIRECT' as const };
const content = 'IP-CIDR,192.0.2.0/24,no-resolve\nIP-CIDR,198.51.100.0/24';
const source = { id: 's', kind: 'local' as const, format: 'auto' as const, content };
const rules: RuleEntry[] = [
  { id: 'raw', matcher: { kind: 'rule', rule: { type: 'RAW', text: 'IP-CIDR,192.0.2.0/24,no-resolve' } }, target: direct, options: { noResolve: false } },
  { id: 'ir', matcher: { kind: 'rule', rule: { type: 'IP-CIDR6', value: '2001:db8::/32', noResolve: true } }, target: direct, options: { noResolve: false } },
  { id: 'plain', matcher: { kind: 'rule', rule: { type: 'RAW', text: 'IP-CIDR,198.51.100.0/24' } }, target: direct, options: { noResolve: true, src: false } },
];
const cleaned = rules.map(rule => ({ ...rule, options: rule.id === 'plain' ? { src: false } : {} }));
const config = { groups: [], rules, final: direct };

describe('no-resolve 以内容为准', () => {
  it('v17 升级清理独立选项，保留内容、归属、修订、模板历史和已发出的资源，重启幂等', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-rule-resolve-'));
    const file = join(dir, 'state.sqlite'); const cipher = new Cipher(randomBytes(32));
    let store = new Store(file, { cipher, now: () => 1234 });
    try {
      store.put('ruleset', { id: 'rs', name: '规则增强', noResolve: true, sources: [source] }, 'owner');
      store.putTemplateVersion({ id: 't', name: '模板', version: 1, ...config });
      store.putTemplateVersion({ id: 't', name: '模板', version: 2, ...config });
      const base = { name: '订阅', nodeSets: [], overlay: {}, chains: [], refPolicy: { default: 'wrap' as const }, revision: 7 };
      store.put('profile', { ...base, id: 'bound', templateVersion: 1, routing: { mode: 'bound', templateId: 't', groupAdditions: {}, prependRules: rules } }, 'owner');
      store.put('profile', { ...base, id: 'independent', routing: { mode: 'independent', config } }, 'owner');
      store.put('profile', { ...base, id: 'legacy', overlay: { extraRules: rules.map(rule => ({ anchor: 'top' as const, rule })) } }, 'owner');
      store.putToken({ token: 'same-token', profileId: 'bound' });
      const historical = { rulesets: { 'old.list': 'IP-CIDR,198.51.100.0/24,no-resolve\n' } };
      store.putRenderGeneration('bound', 'mihomo', 'old-version', historical);
      store.putLastGood('bound', 'mihomo', historical);
      store.db.pragma('user_version = 17'); store.close(); store = new Store(file, { cipher, now: () => 9999 });
      expect(store.db.pragma('user_version', { simple: true })).toBe(18);
      expect(store.getWithOwner('ruleset', 'rs')).toMatchObject({ owner: 'owner', updatedAt: 1234, doc: { sources: [source] } });
      expect(store.get('ruleset', 'rs')).not.toHaveProperty('noResolve');
      expect(store.listTemplateVersions('t').map(t => t.version)).toEqual([2, 1]);
      for (const version of [1, 2]) expect(store.getTemplate('t', version)!.rules).toEqual(cleaned);
      expect(store.get('profile', 'bound')!.routing).toMatchObject({ prependRules: cleaned });
      expect(store.get('profile', 'independent')!.routing).toMatchObject({ config: { rules: cleaned } });
      expect(store.get('profile', 'legacy')!.routing).toMatchObject({ mode: 'independent', config: { rules: [...cleaned].reverse() } });
      expect(store.getWithOwner('profile', 'bound')).toMatchObject({ owner: 'owner', updatedAt: 1234, doc: { revision: 7, templateVersion: 1 } });
      expect(store.getToken('same-token')!.profileId).toBe('bound');
      expect(store.getRenderGeneration('bound', 'mihomo', 'old-version')).toEqual(historical);
      expect(store.getLastGood('bound', 'mihomo')).toEqual({ renderedAt: 1234, data: historical });
      const snapshot = [store.list('profile'), store.list('ruleset'), store.listAllTemplateVersions()];
      store.close(); store = new Store(file, { cipher });
      expect([store.list('profile'), store.list('ruleset'), store.listAllTemplateVersions()]).toEqual(snapshot);
    } finally { store.close(); rmSync(dir, { recursive: true }); }
  });

  it('保存模板、规则集、独立及绑定订阅时清理旧开关，预览与下载保持单条原文', async () => {
    const h = setupApp();
    try {
      await addUser(h.store, 'admin', 'admin'); const api = client(h.app); await api.login('admin');
      const rs = await api.post('/api/rulesets', { name: '规则增强', noResolve: true, sources: [source] });
      expect(rs.status, rs.text).toBe(201); expect(rs.json.item.noResolve).toBeUndefined();
      expect(rs.json.item.sources[0].content).toBe(content);
      const t = await api.post('/api/templates/new/publish', { name: '模板', ...config });
      expect(t.status, t.text).toBe(201); expect(t.json.item.rules).toEqual(cleaned);
      for (const mode of ['independent', 'bound'] as const) {
        const profile = { name: mode, nodeSets: [], overlay: {}, ...(mode === 'bound' ? { templateVersion: 1 } : {}), routing: mode === 'independent'
          ? { mode, config } : { mode, templateId: t.json.item.id, groupAdditions: {}, prependRules: rules.map(rule => ({ ...rule, id: 'pre-' + rule.id })) } };
        const saved = await api.post('/api/profiles', profile);
        expect(saved.status, saved.text).toBe(201);
        expect(mode === 'bound' ? saved.json.item.routing.prependRules : saved.json.item.routing.config.rules).toEqual(mode === 'bound' ? cleaned.map(rule => ({ ...rule, id: 'pre-' + rule.id })) : cleaned);
        const preview = await api.post('/api/profiles/preview', { profile: saved.json.item });
        expect(preview.status, preview.text).toBe(200);
        const token = h.store.createToken(saved.json.item.id).token;
        const download = await h.app.request(`/sub/${token}`);
        expect(download.status).toBe(200);
        for (const output of [preview.json.yaml, await download.text()]) {
          expect(output).toContain('IP-CIDR,192.0.2.0/24,DIRECT,no-resolve');
          expect(output).toContain('IP-CIDR6,2001:db8::/32,DIRECT,no-resolve');
          expect(output).toContain('IP-CIDR,198.51.100.0/24,DIRECT');
          expect(output).not.toContain('IP-CIDR,198.51.100.0/24,DIRECT,no-resolve');
        }
      }
    } finally { await h.snapshots.settled(); h.store.close(); }
  });

  it.each([true, false])('GET 与两种预览接口逐行保留标记，忽略旧开关 %s，增强替换/追加以新原文为准', async noResolve => {
    const h = setupApp({ fetcher: async () => ({ status: 200, body: content }) });
    try {
      await addUser(h.store, 'alice'); const api = client(h.app); await api.login('alice');
      const converted = await api.post('/api/rules/convert', { inputs: [{ source, content }], client: 'mihomo', noResolve });
      expect(converted.status).toBe(200); expect(converted.json.lines).toEqual(content.split('\n'));
      const preview = await api.post('/api/rulesets/preview', { ruleset: { name: '预览', noResolve, sources: [source] }, client: 'mihomo' });
      expect(preview.status).toBe(200); expect(preview.json.lines).toEqual(converted.json.lines);
      const get = await api.get('/api/rules/convert?url=https%3A%2F%2Fexample.test%2Frules.list');
      expect(get.status).toBe(200); expect(get.text).toBe(content + '\n');
      const enhanced = await api.post('/api/rules/convert', { inputs: [{ source, content }], client: 'mihomo', noResolve, overrides: [
        { match: 'IP-CIDR,192.0.2.0/24,no-resolve', override: { when: { client: 'mihomo' }, action: { replace: [{ type: 'RAW', text: 'IP-CIDR,203.0.113.0/24' }] } } },
        { override: { when: { client: 'mihomo' }, action: { append: [{ type: 'RAW', text: 'GEOIP,CN,no-resolve' }] } } },
      ] });
      expect(enhanced.status, enhanced.text).toBe(200);
      const active = enhanced.json.lines.filter((line: string) => !line.startsWith('#'));
      expect(active).toEqual(['IP-CIDR,203.0.113.0/24', 'IP-CIDR,198.51.100.0/24', 'GEOIP,CN,no-resolve']);
    } finally { await h.snapshots.settled(); h.store.close(); }
  });
});
