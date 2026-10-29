import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { addUser, client, setupApp } from './helpers.ts';

const body = 'payload:\n  - DOMAIN,example.com\n  - IP-CIDR,10.0.0.0/8,no-resolve\n  - DOMAIN-KEYWORD,example\n  - USER-AGENT,Unsupported*';
describe('远程 YAML 转换为托管 LIST', () => {
  it.each(['auto', 'yaml'] as const)('%s 输入预览、保存、实际 provider 均为托管文本，保留无法转换行诊断', async format => {
    const h = setupApp({ fetcher: async () => ({ status: 200, body }) });
    try {
      const user = await addUser(h.store, 'alice'); const c = client(h.app); await c.login('alice');
      const source = { id: 'yaml', kind: 'remote', format, url: 'https://example.com/input.yaml' };
      const doc = { name: 'YAML 转 LIST', sources: [source] };
      const preview = await c.post('/api/rulesets/preview', { ruleset: doc, source: 'yaml', client: 'mihomo' });
      expect(preview.status).toBe(200);
      expect(preview.json).toMatchObject({ passthrough: false, sources: [{ conversion: 'yaml-to-list', rules: 3, rejected: 1 }] });
      expect(preview.json.lines).toContain('DOMAIN,example.com');
      expect(preview.json.lines).toContain('IP-CIDR,10.0.0.0/8,no-resolve');
      const saved = await c.post('/api/rulesets', doc); expect(saved.status).toBe(201);
      const id = saved.json.item.id;
      h.store.put('profile', { id: 'profile', name: '转换验证', nodeSets: [], chains: [], refPolicy: { default: 'wrap' }, overlay: { extraRules: [{ anchor: 'top', rule: { id: 'r', matcher: { kind: 'ruleset', id }, target: { kind: 'builtin', name: 'REJECT' } } }] } }, user.id);
      const rendered = await h.renderer.render('profile', { client: 'mihomo' });
      expect(rendered.ok).toBe(true);
      if (!rendered.ok) throw new Error('渲染失败');
      const output = parse(rendered.render.yaml);
      const providers = Object.values(output['rule-providers']) as {format:string;url:string}[];
      expect(providers).toHaveLength(1);
      expect(providers.every(p=>p.format==='text' && p.url.startsWith('https://sub.test/r/'))).toBe(true);
      expect(rendered.render.yaml).not.toContain(source.url);
      expect(Object.values(rendered.render.rulesets).every(text=>!String(text).includes('payload:'))).toBe(true);
      expect((await c.get(`/api/rulesets/${id}`)).json.item.sources[0].url).toBe(source.url);
    } finally { h.store.close(); }
  });
  it('保存、草稿预览拒绝将 YAML 地址标为 mrs/srs 透传', async () => {
    const h = setupApp();
    try {
      await addUser(h.store,'alice'); const c=client(h.app); await c.login('alice');
      for (const format of ['mrs','srs']) {
        const ruleset={name:'禁止透传',sources:[{id:'s',kind:'remote',url:'https://example.com/input.YML?download=1',format,behavior:'domain'}]};
        expect((await c.post('/api/rulesets',ruleset)).status).toBe(400);
        expect((await c.post('/api/rulesets/preview',{ruleset,client:'mihomo'})).status).toBe(400);
      }
    } finally { h.store.close(); }
  });
  it('无扩展名的既有 YAML 来源仍不可改为二进制透传', async () => {
    const h = setupApp();
    try {
      await addUser(h.store, 'alice'); const c = client(h.app); await c.login('alice');
      const created = await c.post('/api/rulesets', { name: '无扩展名 YAML', sources: [{ id: 's', kind: 'remote', url: 'https://example.com/rules', format: 'yaml' }] });
      expect(created.status).toBe(201);
      const doc = created.json.item;
      for (const format of ['mrs', 'srs']) {
        const result = await c.put(`/api/rulesets/${doc.id}`, { ...doc, sources: [{ ...doc.sources[0], format, behavior: 'domain' }] });
        expect(result.status).toBe(400);
      }
      expect((await c.get(`/api/rulesets/${doc.id}`)).json.item.sources[0].format).toBe('yaml');
    } finally { h.store.close(); }
  });
});
