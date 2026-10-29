import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { remoteRuleMatcher } from '@sub-forge/core';
import { addUser, client, setupApp } from './helpers.ts';

const url = 'https://example.test/owned.yaml?branch=main&download=1';
const draft = (matcher = remoteRuleMatcher(url)) => ({ name: '远程模板', groups: [], rules: [{ id: 'remote-rule', matcher, target: { kind: 'builtin', name: 'DIRECT' }, options: { noResolve: true } }], final: { kind: 'builtin', name: 'REJECT' } });

describe('外部 URL 与系统 ID 分开引用', () => {
  it.each(['legacy', 'bound'])('%s 模式发布、订阅输出嵌套 GET、快照缓存、版本保留和撤销 token 闭环', async mode => {
    const calls: string[] = [];
    const h = setupApp({ fetcher: async value => { calls.push(value); return { status: 200, body: 'payload:\n  - DOMAIN,example.test\n  - IP-CIDR,10.0.0.0/8' }; } });
    try {
      const user = await addUser(h.store, 'admin', 'admin'); const c = client(h.app); await c.login('admin');
      const published = await c.post('/api/templates/new/publish', draft());
      expect(published.status, published.text).toBe(201);
      const routing = mode === 'bound'
        ? { routing: { mode: 'bound', templateId: published.json.item.id, groupAdditions: {} }, templateVersion: 1 }
        : { template: { id: published.json.item.id, follow: 'latest' } };
      const p = await c.post('/api/profiles', { name: '外部规则订阅', nodeSets: [], overlay: {}, ...routing });
      expect(p.status, p.text).toBe(201);
      const token = h.store.createToken(p.json.item.id).token;
      const main = await h.app.request(`/sub/${token}`);
      expect(main.status).toBe(200);
      const config = parse(await main.text());
      const provider = Object.values(config['rule-providers'])[0] as { url: string; format: string; behavior: string };
      expect(provider).toMatchObject({ format: 'text', behavior: 'classical' });
      const nested = new URL(provider.url);
      expect(nested.pathname).toBe('/api/rules/convert');
      expect(nested.searchParams.get('url')).toBe(url);
      expect(h.store.list('ruleset')).toEqual([]);
      const download = await h.app.request(provider.url);
      expect(download.status).toBe(200);
      const output = await download.text();
      expect(output).toContain('DOMAIN,example.test');
      expect(output).toContain('IP-CIDR,10.0.0.0/8,no-resolve');
      expect(download.headers.get('content-type')).toContain('text/plain');
      expect(calls).toEqual([url]);
      const edited = new URL(provider.url); edited.searchParams.set('url', 'https://unrelated.test/list');
      expect((await h.app.request(edited.href)).status).toBe(404);
      expect(calls).toEqual([url]);
      const other = h.store.createToken('unrelated').token;
      edited.searchParams.set('url', url); edited.searchParams.set('token', other);
      expect((await h.app.request(edited.href)).status).toBe(404);
      const changed = await c.post(`/api/templates/${published.json.item.id}/publish`, draft(remoteRuleMatcher('https://example.test/new.list')));
      expect(changed.status, changed.text).toBe(200);
      expect((await h.app.request(provider.url)).status).toBe(200);
      expect(h.store.list('ruleset')).toEqual([]);
      h.store.deleteToken(token);
      expect((await h.app.request(provider.url)).status).toBe(404);
      expect(user.role).toBe('admin');
    } finally { await h.snapshots.settled(); h.store.close(); }
  });

  it.each(['legacy', 'independent'])('%s 模式可直接引用 URL；系统 ID 不根据地址自动替换，私有 ID 权限不变', async mode => {
    const h = setupApp({ fetcher: async () => ({ status: 200, body: 'DOMAIN,example.test' }) });
    try {
      const alice = await addUser(h.store, 'alice'); const bob = await addUser(h.store, 'bob'); const c = client(h.app); await c.login('alice');
      h.store.put('ruleset', { id: 'system', name: '系统规则', sources: [{ id:'s', kind:'remote', format:'auto', url }] }, alice.id);
      h.store.put('ruleset', { id: 'private', name: '私有规则', sources: [] }, bob.id);
      const create = (matcher: object) => {
        const rule = { ...draft().rules[0], matcher };
        return c.post('/api/profiles', { name: '私有规则引用', nodeSets: [], ...(mode === 'independent'
          ? { overlay: {}, routing: { mode, config: { groups: [], rules: [rule], final: draft().final } } }
          : { overlay: { extraRules: [{ anchor: 'top', rule }] } }) });
      };
      const external = await create(remoteRuleMatcher(url)); expect(external.status).toBe(201);
      const internal = await create({ kind: 'ruleset', id: 'system' }); expect(internal.status).toBe(201);
      expect(internal.json.item.routing.mode).toBe('independent');
      expect(external.json.item.routing.mode).toBe('independent');
      expect(internal.json.item.routing.config.rules[0].matcher).toEqual({ kind:'ruleset',id:'system' });
      expect(external.json.item.routing.config.rules[0].matcher.remote).toEqual({ url });
      const token = h.store.createToken(external.json.item.id).token;
      const config = parse(await (await h.app.request(`/sub/${token}`)).text());
      const provider = Object.values(config['rule-providers'])[0] as { url: string };
      expect(new URL(provider.url).searchParams.get('url')).toBe(url);
      expect(await (await h.app.request(provider.url)).text()).toContain('DOMAIN,example.test');
      expect((await create({ kind: 'ruleset', id: 'private' })).status).toBe(400);
      expect((await create({ ...remoteRuleMatcher(url), id: 'system' })).status).toBe(400);
      expect((await create({ ...remoteRuleMatcher(url), repository: {} })).status).toBe(400);
    } finally { await h.snapshots.settled(); h.store.close(); }
  });

  it('绑定模板转为独立配置后保留远程引用，保存和下载继续有效', async () => {
    const h = setupApp({ fetcher: async () => ({ status: 200, body: 'DOMAIN,example.test' }) });
    try {
      await addUser(h.store, 'admin', 'admin'); const c = client(h.app); await c.login('admin');
      const published = await c.post('/api/templates/new/publish', draft());
      const profile = await c.post('/api/profiles', { name: '转为独立配置', nodeSets: [], overlay: {}, routing: { mode: 'bound', templateId: published.json.item.id, groupAdditions: {} }, templateVersion: 1 });
      expect(profile.status, profile.text).toBe(201);
      const converted = await c.post('/api/profiles/routing/convert', { profile: profile.json.item, mode: 'independent', currentTemplateVersion: 1 });
      expect(converted.status, converted.text).toBe(200);
      expect(converted.json.item.routing.config.rules[0].matcher).toEqual(remoteRuleMatcher(url));
      const saved = await c.put(`/api/profiles/${profile.json.item.id}`, converted.json.item);
      expect(saved.status, saved.text).toBe(200);
      expect((await c.post(`/api/templates/${published.json.item.id}/publish`, draft(remoteRuleMatcher('https://example.test/changed.list')))).status).toBe(200);
      const token = h.store.createToken(profile.json.item.id).token;
      const config = parse(await (await h.app.request(`/sub/${token}`)).text());
      const provider = Object.values(config['rule-providers'])[0] as { url: string };
      expect(new URL(provider.url).searchParams.get('url')).toBe(url);
      expect(await (await h.app.request(provider.url)).text()).toContain('DOMAIN,example.test');
      expect(h.store.list('ruleset')).toEqual([]);
    } finally { await h.snapshots.settled(); h.store.close(); }
  });

  it('登录 GET 转换自动识别内容，URL 编码完整，无可用规则或格式错误不返回成功文件', async () => {
    let body = '+.example.test\nexact.test'; let calls=0;
    const h = setupApp({ fetcher: async () => { calls++; return { status:200,body }; } });
    try {
      const path = `/api/rules/convert?url=${encodeURIComponent(url)}`;
      expect((await h.app.request(path)).status).toBe(401);
      await addUser(h.store,'alice'); const c=client(h.app); await c.login('alice');
      const result=await c.get(path); expect(result.status).toBe(200);
      expect(result.text).toBe('DOMAIN-SUFFIX,example.test\nDOMAIN,exact.test\n');
      expect(result.headers.get('content-disposition')).toContain('rules.list');
      expect((await c.get(path+'&target=surge')).status).toBe(200); expect(calls).toBe(1);
      expect((await c.get('/api/rules/convert?url=file%3A%2F%2Fetc%2Fpasswd')).status).toBe(400);
      expect((await c.get(path+'&target=invalid')).status).toBe(400);
      body='<html>error page</html>';
      expect((await c.get(`/api/rules/convert?url=${encodeURIComponent('https://example.test/error')}`)).status).toBe(400);
      body='DOMAIN,good.test\nBOGUS,bad.test';
      const partial=await c.get(`/api/rules/convert?url=${encodeURIComponent('https://example.test/partial')}`);
      expect(partial.status).toBe(200);expect(partial.headers.get('x-rule-rejected')).toBe('1');expect(partial.text).toContain('# [本系统暂未支持解析');
    } finally { h.store.close(); }
  });
});
