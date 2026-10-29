import { afterEach, describe, expect, it } from 'vitest';
import { setupRuleReferences } from './rule-reference-fixture.ts';
import { client } from './helpers.ts';

const envs: Awaited<ReturnType<typeof setupRuleReferences>>[] = [];
afterEach(async () => { for (const env of envs.splice(0)) await env.stop(); });
const setup = async () => { const env = await setupRuleReferences(); envs.push(env); return env; };
const url = (path: string, ref = 'master') => `/api/rule-repos/file-preview?${new URLSearchParams({ repo: 'blackmatrix7', ref, path })}`;

describe('仓库单文件原文预览', () => {
  it('只读所选文件的固定提交，保留原始注释与空行，不聚合、不创建规则集', async () => {
    const h = await setup();
    h.setPaths(['rule/Clash/China/China.list', 'rule/Clash/China/China_Domain.list', 'rule/Surge/China/China.list']);
    await h.repos.refresh('blackmatrix7');
    const content = '# 原始注释\r\n\r\nDOMAIN,preview.example.test\r\n';
    h.setBody(content); h.reads.length = 0;
    const result = await h.admin.get(url('rule/Clash/China/China.list'));
    expect(result.status).toBe(200);
    expect(result.json.item).toMatchObject({ name: 'China.list', content, entry: 'China', ref: 'master', path: 'rule/Clash/China/China.list' });
    expect(result.json.item.upstream).toContain(`/blob/${'b'.repeat(40)}/rule/Clash/China/China.list`);
    expect(h.reads).toEqual([{ repo: 'blackmatrix7', commit: 'b'.repeat(40), path: 'rule/Clash/China/China.list' }]);
    expect(h.calls).toEqual([]);
    expect(h.store.list('ruleset')).toHaveLength(2);
    h.setBody('DOMAIN,surge.example.test');
    expect((await h.admin.get(url('rule/Surge/China/China.list'))).json.item.content).toBe('DOMAIN,surge.example.test');
  });
  it('登录、成员资格、后缀与分支校验在读取前完成', async () => {
    const h = await setup(); h.reads.length = 0;
    expect((await client(h.app).get(url('rule/Surge/Google/Google.list'))).status).toBe(401);
    expect((await h.admin.get('/api/rule-repos/file-preview?repo=blackmatrix7')).status).toBe(400);
    for (const path of ['rule/Surge/Google/README.md', 'rule/Surge/Google/Google.yaml', '../outside.txt', 'rule/Surge/Google/fake.list']) expect((await h.admin.get(url(path))).status).toBe(400);
    expect((await h.admin.get(url('rule/Surge/Google/Google.list', 'wrong-branch'))).status).toBe(400);
    h.repos.setEnabled('blackmatrix7', false);
    expect((await h.admin.get(url('rule/Surge/Google/Google.list'))).status).toBe(404);
    expect(h.reads).toEqual([]);
  });
  it('读取失败可重试，空文件和无有效规则的文本仍能查看原文', async () => {
    const h = await setup();
    h.setReadError('模拟 Git 正文读取失败');
    const failed = await h.admin.get(url('rule/Surge/Google/Google.list'));
    expect(failed.status).toBe(502); expect(failed.json.error).toContain('模拟 Git 正文读取失败');
    h.setReadError(); h.setBody('');
    expect((await h.admin.get(url('rule/Surge/Google/Google.list'))).json.item.content).toBe('');
    h.setBody('# 仅注释\n无有效规则\n');
    expect((await h.admin.get(url('rule/Surge/Google/Google.list'))).json.item.content).toBe('# 仅注释\n无有效规则\n');
  });
  it('读取期间索引停用后拒绝返回过期正文', async () => {
    const h = await setup();
    let release!: () => void;
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    h.setBeforeRead(() => { started(); return new Promise<void>(resolve => { release = resolve; }); });
    const pending = h.admin.get(url('rule/Surge/Google/Google.list'));
    await ready;
    h.repos.setEnabled('blackmatrix7', false); release();
    expect((await pending).status).toBe(404);
  });
});
