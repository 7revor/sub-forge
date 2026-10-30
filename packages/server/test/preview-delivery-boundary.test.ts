import { afterEach, expect, it } from 'vitest';
import { remoteRuleMatcher } from '@sub-forge/core';
import { setupRuleReferences } from './rule-reference-fixture.ts';

const envs: Awaited<ReturnType<typeof setupRuleReferences>>[] = [];
afterEach(async () => { for (const env of envs.splice(0)) await env.stop(); });

it.each(['mihomo', 'stash', 'surge', 'loon'])('%s：预览选项直达源文件，实际订阅仍按客户端生成与隔离', async target => {
  const h = await setupRuleReferences(); envs.push(h);
  h.setBody('DOMAIN,source.example.test\nUSER-AGENT,Example*');
  const options = (await h.admin.get('/api/rule-options/search?scope=repository')).json.items;
  const raw = options.find((option: { label: string }) => option.label === 'Google.list').url;
  expect(raw).toBe('https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Surge/Google/Google.list');
  expect(new URL(raw).searchParams.has('token')).toBe(false);
  const repository = await h.resolve();
  const local = h.store.get('ruleset', 'local-google')!;
  h.store.put('ruleset', { ...local, overrides: [{ override: { when: { client: 'surge' }, action: { append: [{ type: 'DOMAIN', value: 'enhanced.example.test' }] } } }] }, h.user.id);
  const direct = { kind: 'builtin' as const, name: 'DIRECT' as const };
  h.store.put('profile', {
    id: 'preview-boundary', name: '预览与托管分离', nodeSets: [], overlay: {}, chains: [], refPolicy: { default: 'wrap' },
    routing: { mode: 'independent', config: { groups: [], final: direct, rules: [
      { id: 'repository', matcher: repository, target: direct },
      { id: 'remote', matcher: remoteRuleMatcher('https://example.test/remote.list'), target: direct },
      { id: 'enhanced', matcher: { kind: 'ruleset', id: local.id }, target: direct },
    ] } },
  }, h.user.id);
  const token = h.store.userToken(h.user.id)!.token;
  const response = await h.app.request(`/subs/profile?${new URLSearchParams({ id: 'preview-boundary', token, target, platform: 'ios' })}`);
  const body = await response.text();
  expect(response.status, body).toBe(200);
  const links = [...new Set(body.match(/https:\/\/sub\.test\/(?:resources|subs)\/[^\s"',]+/g))]
    .map(link => new URL(link)).filter(url => url.pathname !== '/subs/profile');
  if (target === 'loon') {
    // Loon 按原位置展开以保留规则顺序，不能为统一链接而改成远程规则段。
    expect(links).toEqual([]);
    expect(body).toContain('DOMAIN,source.example.test,DIRECT');
    expect(body).toContain('DOMAIN,local.example.test,DIRECT');
    expect(body).not.toContain(raw);
    return;
  }
  expect(links.map(url => url.pathname).sort()).toEqual(['/resources/repo', '/resources/ruleset', '/subs/ruleset']);
  for (const link of links) {
    expect(link.searchParams.get('token')).toBe(token);
    expect(link.href).not.toBe(raw);
    const resource = await h.app.request(link.href);
    const text = await resource.text();
    expect(resource.status, text).toBe(200);
    if (link.pathname === '/resources/ruleset') expect(/^DOMAIN,enhanced\.example\.test$/m.test(text)).toBe(target === 'surge');
    if (link.pathname === '/subs/ruleset') {
      expect(link.searchParams.get('profile')).toBe('preview-boundary');
      expect(link.searchParams.get('target')).toBe(target);
    }
  }
});
