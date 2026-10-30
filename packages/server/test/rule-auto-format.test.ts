import { ruleBodies } from './helpers.ts';
import { issueProfileToken } from './helpers.ts';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { addUser, client, setupApp } from './helpers.ts';

const yaml = 'payload: ["DOMAIN,example.test", "IP-CIDR,192.0.2.0/24,no-resolve"]';

describe('自动格式贯通预览、保存与下载', () => {
  it.each(['text', 'yaml'])('%s 远程 wildcard 大小写去重贯通合并预览与实际下载', async format => {
    const rows = [
      'PROCESS-NAME-WILDCARD,Example*', 'PROCESS-NAME-WILDCARD,example*',
      'PROCESS-PATH-WILDCARD,/Apps/*', 'PROCESS-PATH-WILDCARD,/apps/*',
      'DOMAIN-WILDCARD,*.Example.test', 'DOMAIN-WILDCARD,*.example.test',
    ];
    const body = format === 'yaml' ? `payload: ${JSON.stringify(rows)}` : rows.join('\n');
    const h = setupApp({ fetcher: async () => ({ status: 200, body }) });
    try {
      const user = await addUser(h.store, 'alice'); const c = client(h.app); await c.login('alice');
      const draft = { name: 'wildcard 去重', sources: [{ id: 's', kind: 'remote', url: 'https://example.test/wildcard' }] };
      const preview = await c.post('/api/rulesets/preview', { ruleset: draft, client: 'mihomo' });
      expect(preview.status).toBe(200);
      expect(preview.json.delivery.mode).toBe('managed');
      expect(preview.json.lines.filter((line: string) => line && !line.startsWith('#'))).toEqual([rows[0], rows[2], rows[4]]);
      const surge = await c.post('/api/rulesets/preview', { ruleset: draft, client: 'surge', platform: 'macos' });
      expect(surge.json.lines.filter((line: string) => line && !line.startsWith('#'))).toHaveLength(6);
      const saved = await c.post('/api/rulesets', draft);
      expect(saved.status).toBe(201);
      h.store.put('profile', { id: 'p', name: '下载', nodeSets: [], chains: [], refPolicy: { default: 'wrap' }, overlay: { extraRules: [{ anchor: 'top', rule: { id: 'r', matcher: { kind: 'ruleset', id: saved.json.item.id }, target: { kind: 'builtin', name: 'DIRECT' } } }] } }, user.id);
      issueProfileToken(h.store, { token: 'test', profileId: 'p' });
      const config = parse(await (await h.app.request('/subs/profile?token=test&id=p')).text());
      const provider = (Object.values(config['rule-providers']) as { url: string; format: string }[])[0]!;
      expect(provider.format).toBe('text');
      const url = new URL(provider.url);
      expect(url.pathname).toBe('/resources/ruleset');
      expect(url.searchParams.get('key')).toMatch(/^[0-9a-f]{64}$/);
      const download = await h.app.request(url.pathname + url.search);
      expect(download.status).toBe(200);
      expect((await download.text()).trim().split('\n')).toEqual(preview.json.lines);
      expect((await c.get(`/api/rulesets?id=${saved.json.item.id}`)).json.item.sources[0].url).toBe(draft.sources[0]!.url);
    } finally { await h.snapshots.settled(); h.store.close(); }
  });

  it('省略格式也能保存，TXT 地址按实际 YAML 内容识别；预览转换且统一托管下发', async () => {
    const h = setupApp({ fetcher: async () => ({ status: 200, body: yaml }) });
    try {
      const user = await addUser(h.store, 'alice'); const c = client(h.app); await c.login('alice');
      const draft = { name: '自动识别', sources: [{ id: 's', kind: 'remote', url: 'https://example.test/rules.txt' }] };
      const pre = await c.post('/api/rulesets/preview', { ruleset: draft, source: 's' });
      expect(pre.status).toBe(200);
      expect(pre.json).toMatchObject({ delivery: { mode: 'managed', format: 'text', behavior: 'classical' }, sources: [{ format: 'yaml', behavior: 'classical', rules: 2 }], lines: ['DOMAIN,example.test', 'IP-CIDR,192.0.2.0/24,no-resolve'] });
      const saved = await c.post('/api/rulesets', draft);
      expect(saved.status).toBe(201);
      expect(saved.json.item.sources[0].format).toBe('auto');
      const id = saved.json.item.id;
      h.store.put('profile', { id: 'p', name: '下载', nodeSets: [], chains: [], refPolicy: { default: 'wrap' }, overlay: { extraRules: [{ anchor: 'top', rule: { id: 'r', matcher: { kind: 'ruleset', id }, target: { kind: 'builtin', name: 'DIRECT' } } }] } }, user.id);
      issueProfileToken(h.store, { token: 'test', profileId: 'p' });
      const original = parse(await (await h.app.request('/subs/profile?token=test&id=p')).text());
      expect(Object.values(original['rule-providers'])).toEqual([expect.objectContaining({ format: 'text', behavior: 'classical', url: expect.stringContaining('/resources/ruleset?') })]);
      // 增加本地来源后切换到一个 LIST；已有来源格式不需要手动改动。
      const merged = { ...saved.json.item, sources: [...saved.json.item.sources, { id: 'local', kind: 'local', content: 'DOMAIN,local.test' }] };
      expect((await c.put(`/api/rulesets/${id}`, merged)).status).toBe(200);
      const mergedPre = await c.post('/api/rulesets/preview', { id, ruleset: merged });
      expect(mergedPre.json.delivery.mode).toBe('managed');
      const config = parse(await (await h.app.request('/subs/profile?token=test&id=p')).text());
      const providers = Object.values(config['rule-providers']) as { url: string; behavior: string; format: string }[];
      expect(providers).toHaveLength(1);
      expect(providers[0]).toMatchObject({ behavior: 'classical', format: 'text' });
      const url = new URL(providers[0]!.url);
      expect(url.pathname).toBe('/resources/ruleset');
      expect(url.searchParams.get('key')).toMatch(/^[0-9a-f]{64}$/);
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
      expect(parse(before.render.yaml)['rule-providers']['旧设置']).toMatchObject({ format: 'text', behavior: 'classical' });
      body = '192.0.2.0/24';
      await h.snapshots.refresh('ruleset', 'r', 'https://example.test/no-extension', { format: 'ipcidr' });
      const after = await h.renderer.render('p', { client: 'mihomo' });
      expect(after.ok).toBe(true);
      if (!after.ok) throw new Error(after.message);
      expect(parse(after.render.yaml)['rule-providers']['旧设置']).toMatchObject({ format: 'text', behavior: 'classical' });
      expect(parse(after.render.yaml)['rule-providers']['旧设置'].url).toBe(parse(before.render.yaml)['rule-providers']['旧设置'].url);
      expect(ruleBodies(h.store, after.render)['rs_r_classical.list']).toContain('192.0.2.0/24');
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
