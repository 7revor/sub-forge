import { parse } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { setupRuleReferences } from './rule-reference-fixture.ts';
import { client } from './helpers.ts';

const envs: Awaited<ReturnType<typeof setupRuleReferences>>[] = [];
afterEach(async () => { for (const env of envs.splice(0)) await env.stop(); });
const setup = async (options: { cacheSnapshots?: boolean } = {}) => { const env = await setupRuleReferences(options); envs.push(env); return env; };
const read = (h: { repos: { filePreview(repo: string, ref: string, path: string): Promise<unknown> } }, path: string, ref = 'master') => h.repos.filePreview('blackmatrix7', ref, path)
  .then(item => ({ status: 200, json: { item } as { item: any; error?: string } }), (error: Error & { status?: number }) => ({ status: error.status ?? 502, json: { error: error.message } as { item: any; error?: string } }));

describe('仓库单文件原文预览', () => {
  it('只读所选文件的固定提交，保留原始注释与空行，不聚合、不创建规则集', async () => {
    const h = await setup();
    h.setPaths(['rule/Clash/China/China.list', 'rule/Clash/China/China_Domain.list', 'rule/Surge/China/China.list']);
    await h.repos.refresh('blackmatrix7');
    const content = '# 原始注释\r\n\r\nDOMAIN,preview.example.test\r\n';
    h.setBody(content); h.reads.length = 0;
    const result = await read(h, 'rule/Clash/China/China.list');
    expect(result.status).toBe(200);
    expect(result.json.item).toMatchObject({ name: 'China.list', content, entry: 'China', ref: 'master', path: 'rule/Clash/China/China.list' });
    expect(result.json.item.upstream).toContain(`/blob/${'b'.repeat(40)}/rule/Clash/China/China.list`);
    expect(h.reads).toEqual([{ repo: 'blackmatrix7', commit: 'b'.repeat(40), path: 'rule/Clash/China/China.list' }]);
    expect(h.calls).toEqual([]);
    expect(h.store.list('ruleset')).toHaveLength(2);
    h.setBody('DOMAIN,surge.example.test');
    expect((await read(h, 'rule/Surge/China/China.list')).json.item.content).toBe('DOMAIN,surge.example.test');
  });
  it('成员资格、后缀与分支校验在读取前完成', async () => {
    const h = await setup(); h.reads.length = 0;
    for (const path of ['rule/Surge/Google/README.md', 'rule/Surge/Google/Google.yaml', '../outside.txt', 'rule/Surge/Google/fake.list']) expect((await read(h, path)).status).toBe(400);
    expect((await read(h, 'rule/Surge/Google/Google.list', 'wrong-branch')).status).toBe(400);
    h.repos.setEnabled('blackmatrix7', false);
    expect((await read(h, 'rule/Surge/Google/Google.list')).status).toBe(404);
    expect(h.reads).toEqual([]);
  });
  it('读取失败可重试，空文件和无有效规则的文本仍能查看原文', async () => {
    const h = await setup();
    h.setReadError('模拟 Git 正文读取失败');
    const failed = await read(h, 'rule/Surge/Google/Google.list');
    expect(failed.status).toBe(502); expect(failed.json.error).toContain('模拟 Git 正文读取失败');
    h.setReadError(); h.setBody('');
    expect((await read(h, 'rule/Surge/Google/Google.list')).json.item.content).toBe('');
    h.setBody('# 仅注释\n无有效规则\n');
    expect((await read(h, 'rule/Surge/Google/Google.list')).json.item.content).toBe('# 仅注释\n无有效规则\n');
  });
  it('读取期间索引停用后拒绝返回过期正文', async () => {
    const h = await setup();
    let release!: () => void;
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    h.setBeforeRead(() => { started(); return new Promise<void>(resolve => { release = resolve; }); });
    const pending = read(h, 'rule/Surge/Google/Google.list');
    await ready;
    h.repos.setEnabled('blackmatrix7', false); release();
    expect((await pending).status).toBe(404);
  });
});

it('带 token 的仓库文件读取按访问者记录，GET 和 HEAD 归入规则集合', async () => {
  const h = await setup();
  const token = h.store.userToken(h.privateUser.id)!.token;
  const path = `/resources/repo?token=${token}&${new URLSearchParams({ id: 'blackmatrix7', ref: 'master', path: 'rule/Surge/Google/Google.list' })}`;
  for (const method of ['GET', 'HEAD']) expect((await h.app.request(path, { method })).status).toBe(200);
  const page = { page: 1, pageSize: 20, q: '' };
  expect(h.store.userAccessPage(h.user.id, page).total).toBe(0);
  const result = h.store.userAccessPage(h.privateUser.id, page);
  expect(result.total).toBe(2);
  expect(result.items).toMatchObject([{ kind: 'rule-collection', resourceName: 'Google.list', method: 'HEAD', source: 'file' }, { kind: 'rule-collection', method: 'GET' }]);
});

it('主配置写入仓库文件身份，地址无需服务端映射即可转换；仓库停用后不可读', async () => {
  const h = await setup({ cacheSnapshots: true });
  const token = h.store.userToken(h.privateUser.id)!.token;
  const matcher = await h.resolve();
  h.store.put('profile', { id: 'repo-profile', name: '仓库', nodeSets: [], chains: [], overlay: {}, refPolicy: { default: 'wrap' }, routing: { mode: 'independent', config: { groups: [], rules: [{ id: 'r', matcher, target: { kind: 'builtin', name: 'DIRECT' } }], final: { kind: 'builtin', name: 'DIRECT' } } } }, h.privateUser.id);
  const config = parse(await (await h.app.request(`/subs/profile?id=repo-profile&token=${token}`)).text());
  const url = new URL(Object.values<{ url: string }>(config['rule-providers'])[0]!.url);
  expect(url.pathname).toBe('/resources/repo');
  expect(Object.fromEntries(url.searchParams)).toEqual({ id: 'blackmatrix7', files: JSON.stringify([{ ref: 'master', path: 'rule/Surge/Google/Google.list' }]), target: 'mihomo', format: 'text', token });
  const converted = await h.app.request(url.pathname + url.search);
  expect(converted.status).toBe(200); expect(await converted.text()).toContain('google.example.test');
  h.repos.setEnabled('blackmatrix7', false);
  expect((await h.app.request(url.pathname + url.search)).status).toBe(404);
});

const rawRepositoryUrl = (token: string) => `/resources/repo?${new URLSearchParams({ id: 'blackmatrix7', ref: 'master', path: 'rule/Surge/Google/Google.list', token })}`;

it.each(['disable', 'remove-index', 'delete'])('仓库 %s 后旧链接不可访问，转换不再下发', async action => {
  const h = await setup({ cacheSnapshots: true });
  const token = h.store.userToken(h.privateUser.id)!.token;
  const matcher = await h.resolve(), reference = { matcher }, target = { client: 'mihomo' as const };
  expect((await h.renderer.sharedRules.read(reference, target))?.body).toContain('google.example.test');
  const raw = rawRepositoryUrl(token);
  expect((await h.app.request(raw)).status).toBe(200);
  if (action === 'disable') h.repos.setEnabled('blackmatrix7', false);
  else if (action === 'delete') await h.repos.removeCustom('blackmatrix7');
  else { h.setPaths([]); await h.repos.refresh('blackmatrix7'); }
  expect(await h.renderer.sharedRules.read(reference, target)).toBeUndefined();
  expect((await h.app.request(raw)).status).toBe(action === 'remove-index' ? 400 : 404);
});

it.each(['raw', 'first-compile'])('仓库停用后重新启用不恢复在途 %s 请求', async mode => {
  const h = await setup({ cacheSnapshots: true });
  const token = h.store.userToken(h.privateUser.id)!.token;
  let started!: () => void, release!: () => void;
  const began = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  h.setBeforeFetch(async () => { started(); await gate; });
  const matcher = await h.resolve();
  const pending = mode === 'raw' ? h.app.request(rawRepositoryUrl(token)) : h.renderer.sharedRules.read({ matcher }, { client: 'mihomo' });
  await began;
  h.repos.setEnabled('blackmatrix7', false); h.repos.setEnabled('blackmatrix7', true); release();
  const result = await pending;
  if (mode === 'raw') expect((result as Response).status).toBe(404);
  else expect(result).toBeUndefined();
});
