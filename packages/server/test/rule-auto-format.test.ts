import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { addUser, client, setupApp } from './helpers.ts';

const yaml = 'payload: ["DOMAIN,example.test", "IP-CIDR,192.0.2.0/24,no-resolve"]';

describe('自动格式贯通预览、保存与下载', () => {
  it('省略格式也能保存，TXT 地址按实际 YAML 内容识别；预览转换且下载原格式透传', async () => {
    const h = setupApp({ fetcher: async () => ({ status: 200, body: yaml }) });
    try {
      const user = await addUser(h.store, 'alice'); const c = client(h.app); await c.login('alice');
      const draft = { name: '自动识别', sources: [{ id: 's', kind: 'remote', url: 'https://example.test/rules.txt' }] };
      const pre = await c.post('/api/rulesets/preview', { ruleset: draft, source: 's' });
      expect(pre.status).toBe(200);
      expect(pre.json).toMatchObject({ delivery: { mode: 'original', format: 'yaml', behavior: 'classical' }, sources: [{ format: 'yaml', behavior: 'classical', rules: 2 }], lines: ['DOMAIN,example.test', 'IP-CIDR,192.0.2.0/24,no-resolve'] });
      const saved = await c.post('/api/rulesets', draft);
      expect(saved.status).toBe(201);
      expect(saved.json.item.sources[0].format).toBe('auto');
      const id = saved.json.item.id;
      h.store.put('profile', { id: 'p', name: '下载', nodeSets: [], chains: [], refPolicy: { default: 'wrap' }, overlay: { extraRules: [{ anchor: 'top', rule: { id: 'r', matcher: { kind: 'ruleset', id }, target: { kind: 'builtin', name: 'DIRECT' } } }] } }, user.id);
      h.store.putToken({ token: 'test', profileId: 'p' });
      const original = parse(await (await h.app.request('/sub/test')).text());
      expect(Object.values(original['rule-providers'])).toEqual([expect.objectContaining({ format: 'yaml', behavior: 'classical', url: draft.sources[0]!.url })]);
      // 增加本地来源后切换到一个 LIST；已有来源格式不需要手动改动。
      const merged = { ...saved.json.item, sources: [...saved.json.item.sources, { id: 'local', kind: 'local', content: 'DOMAIN,local.test' }] };
      expect((await c.put(`/api/rulesets/${id}`, merged)).status).toBe(200);
      const mergedPre = await c.post('/api/rulesets/preview', { id, ruleset: merged });
      expect(mergedPre.json.delivery.mode).toBe('managed');
      const config = parse(await (await h.app.request('/sub/test')).text());
      const providers = Object.values(config['rule-providers']) as { url: string; behavior: string; format: string }[];
      expect(providers).toHaveLength(1);
      expect(providers[0]).toMatchObject({ behavior: 'classical', format: 'text' });
      const url = new URL(providers[0]!.url);
      expect(url.pathname).toMatch(/\.list$/);
      const download = await h.app.request(url.pathname + url.search);
      expect(download.status).toBe(200);
      expect((await download.text()).trim().split('\n')).toEqual(mergedPre.json.lines);
      expect(config.rules[0]).toMatch(/^RULE-SET,.+,DIRECT$/);
    } finally { await h.snapshots.settled(); h.store.close(); }
  });

  it('旧的显式文本格式不覆盖内容识别；源内容格式变化后重新决定输出配置', async () => {
    let body = yaml;
    const h = setupApp({ fetcher: async () => ({ status: 200, body }) });
    try {
      h.store.put('ruleset', { id: 'r', name: '旧设置', sources: [{ id: 's', kind: 'remote', format: 'ipcidr', url: 'https://example.test/no-extension' }] });
      h.store.put('profile', { id: 'p', name: '下载', nodeSets: [], chains: [], refPolicy: { default: 'wrap' }, overlay: { extraRules: [{ anchor: 'top', rule: { id: 'r', matcher: { kind: 'ruleset', id: 'r' }, target: { kind: 'builtin', name: 'DIRECT' } } }] } });
      const before = await h.renderer.render('p', { client: 'mihomo' });
      expect(before.ok).toBe(true);
      if (!before.ok) throw new Error(before.message);
      expect(parse(before.render.yaml)['rule-providers'].rs_r_original).toMatchObject({ format: 'yaml', behavior: 'classical' });
      body = '192.0.2.0/24';
      await h.snapshots.refresh('ruleset', 'r', 'https://example.test/no-extension', { format: 'ipcidr' });
      const after = await h.renderer.render('p', { client: 'mihomo' });
      expect(after.ok).toBe(true);
      if (!after.ok) throw new Error(after.message);
      expect(parse(after.render.yaml)['rule-providers'].rs_r_original).toMatchObject({ format: 'text', behavior: 'ipcidr' });
      expect(after.render.generation).not.toBe(before.render.generation);
    } finally { await h.snapshots.settled(); h.store.close(); }
  });
  it('输入未完成的本地 YAML 时按来源报告错误，不阻断其他来源预览', async () => {
    const h = setupApp();
    try {
      await addUser(h.store, 'alice'); const c = client(h.app); await c.login('alice');
      const ruleset = { name: '编辑中', sources: [
        { id: 'bad', kind: 'local', content: 'payload: [' },
        { id: 'good', kind: 'local', content: 'DOMAIN,good.test' },
      ] };
      const merged = await c.post('/api/rulesets/preview', { ruleset });
      expect(merged.status).toBe(200);
      expect(merged.json.lines).toEqual([expect.stringContaining('# [输入格式有误'), 'DOMAIN,good.test']);
      expect(merged.json.sources[0]).toMatchObject({ ok: true, rejected: 1, rejectedDetails: [expect.objectContaining({ reason: expect.stringContaining('输入格式有误') })] });
      const selected = await c.post('/api/rulesets/preview', { ruleset, source: 'bad' });
      expect(selected.status).toBe(200);
      expect(selected.json).toMatchObject({ lines: [expect.stringContaining('# [输入格式有误')] });
    } finally { await h.snapshots.settled(); h.store.close(); }
  });

});
