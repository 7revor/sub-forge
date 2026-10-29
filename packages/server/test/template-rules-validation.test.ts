import { afterEach, describe, expect, it } from 'vitest';
import { addUser, client, setupApp } from './helpers.ts';

const envs: ReturnType<typeof setupApp>[] = [];
afterEach(async () => {
  for (const env of envs.splice(0)) { await env.snapshots.settled(); env.store.close(); }
});
async function setup() {
  let response: string | Error = new Error('模拟上游不可用');
  const calls: string[] = [];
  const h = setupApp({ fetcher: async url => {
    calls.push(url); if (response instanceof Error) throw response;
    return { status: 200, body: response };
  } });
  envs.push(h);
  const user = await addUser(h.store, 'admin', 'admin');
  const admin = client(h.app); await admin.login('admin');
  h.store.put('ruleset', { id: 'r', name: '远程规则', sources: [{ id: 's1', kind: 'remote', format: 'classical', url: 'https://rules.example.test/list' }] }, user.id);
  const template = { name: '自检模板', groups: [], rules: [{ id: 'rule', matcher: { kind: 'ruleset', id: 'r' }, target: { kind: 'builtin', name: 'REJECT' } }], final: { kind: 'builtin', name: 'DIRECT' } };
  return { ...h, admin, template, calls, respond: (next: string | Error) => { response = next; h.advance(1000); } };
}

describe('模板自身的规则可用性检查', () => {
  it('没有 Profile 引用的新模板也检查远程规则，force 不能绕过自身错误', async () => {
    const h = await setup();
    const validation = await h.admin.post('/api/templates/validate', h.template);
    expect(validation.json.report).toContainEqual(expect.objectContaining({ level: 'error', code: 'template.ruleset-unavailable', where: 'ruleset:r' }));
    const publish = await h.admin.post('/api/templates/new/publish', { ...h.template, force: true });
    expect(publish.status).toBe(400);
    expect(h.calls.length).toBeGreaterThan(0);
    expect(h.store.listLatestTemplates()).toEqual([]);
    expect(h.store.list('profile')).toEqual([]);
  });

  it.each(['<html>错误页面</html>', 'UNKNOWN,value'])('远程返回不可解析内容 %s 时禁止发布', async body => {
    const h = await setup(); h.respond(body);
    expect((await h.admin.post('/api/templates/new/publish', h.template)).status).toBe(400);
    expect(h.store.listLatestTemplates()).toEqual([]);
  });

  it('本地来源同样检查，输出具体规则集与来源', async () => {
    const h = await setup();
    h.store.put('ruleset', { id: 'r', name: '坏规则', sources: [{ id: 'ok', kind: 'local', format: 'classical', content: 'DOMAIN,a.test' }, { id: 'bad', name: '坏来源', kind: 'local', format: 'yaml', content: 'payload: [' }] });
    const res = await h.admin.post('/api/templates/new/publish', h.template);
    expect(res.status).toBe(400);
    expect(res.json.details.report).toContainEqual(expect.objectContaining({ code: 'template.ruleset-invalid', where: 'ruleset:r', message: expect.stringContaining('来源「坏来源」') }));
    expect(h.calls).toEqual([]);
  });

  it('有效规则可发布；新版本自检失败时版本号与历史版本不变', async () => {
    const h = await setup(); h.respond('DOMAIN,valid.example.test');
    const first = await h.admin.post('/api/templates/new/publish', h.template);
    expect(first.status).toBe(201);
    const id = first.json.item.id;
    h.store.put('ruleset', { id: 'r', name: '坏规则', sources: [{ id: 's1', kind: 'local', format: 'classical', content: 'UNKNOWN,invalid' }] });
    const impact = await h.admin.post(`/api/templates/${id}/impact`, h.template);
    expect(impact.json.report).toContainEqual(expect.objectContaining({ level: 'error' }));
    expect((await h.admin.post(`/api/templates/${id}/publish`, { ...h.template, force: true })).status).toBe(400);
    expect(h.store.listTemplateVersions(id).map(v => v.version)).toEqual([1]);
  });

  it('远程暂时失败但有可用快照时允许发布并告警', async () => {
    const h = await setup(); h.respond('DOMAIN,valid.example.test');
    await h.snapshots.refresh('ruleset', 'r', 'https://rules.example.test/list');
    h.respond(new Error('暂时不可用'));
    await h.snapshots.refresh('ruleset', 'r', 'https://rules.example.test/list');
    const res = await h.admin.post('/api/templates/new/publish', h.template);
    expect(res.status).toBe(201);
    expect(res.json.report).toContainEqual(expect.objectContaining({ level: 'warn', code: 'template.ruleset-snapshot' }));
  });

  it('禁用规则与规则集停用的来源不触发拉取', async () => {
    const h = await setup();
    h.store.put('ruleset', { id: 'b', name: '多来源', sources: [
      { id: 'off', kind: 'remote', format: 'classical', url: 'https://rules.example.test/list', enabled: false },
      { id: 'on', kind: 'local', format: 'classical', content: 'DOMAIN,a.test' },
    ] });
    const res = await h.admin.post('/api/templates/new/publish', { ...h.template, rules: [
      { ...h.template.rules[0], enabled: false },
      { ...h.template.rules[0], id: 'multi', matcher: { kind: 'ruleset', id: 'b' } },
    ] });
    expect(res.status).toBe(201);
    expect(h.calls).toEqual([]);
  });

  it('二进制透传明确标注未检查内容和可达性，不执行服务端下载', async () => {
    const h = await setup();
    const rs = h.store.get('ruleset', 'r')!;
    h.store.put('ruleset', { ...rs, sources: [{ ...rs.sources[0]!, format: 'mrs', behavior: 'domain' }] });
    const res = await h.admin.post('/api/templates/new/publish', h.template);
    expect(res.status).toBe(201);
    expect(res.json.report).toContainEqual(expect.objectContaining({ code: 'template.ruleset-passthrough', level: 'info' }));
    expect(h.calls).toEqual([]);
  });
  it('没有订阅引用时也拒绝需要合并或改写的旧二进制来源', async () => {
    const h = await setup();
    h.store.put('ruleset', { id: 'r', name: '旧二进制', overrides: [{ match: 'DOMAIN,unused.fixture.test', override: { when: { client: 'mihomo' as const }, action: { drop: true as const } } }], sources: [{ id: 's', kind: 'remote', format: 'mrs', behavior: 'ipcidr', url: 'https://example.test/ip.mrs' }] });
    const validation = await h.admin.post('/api/templates/validate', h.template);
    expect(validation.json.report).toContainEqual(expect.objectContaining({ level: 'error', code: 'template.ruleset-invalid', message: expect.stringContaining('无法合并或改写') }));
    expect((await h.admin.post('/api/templates/new/publish', { ...h.template, force: true })).status).toBe(400);
  });

});
