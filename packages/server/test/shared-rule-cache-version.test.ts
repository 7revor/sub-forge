import { createHash } from 'node:crypto';
import { stableStringify } from '@sub-forge/core';
import { afterEach, expect, it, vi } from 'vitest';
import type { RuleSetDoc } from '../src/docs.ts';
import type { SharedRuleRecord } from '../src/shared-rules.ts';
import { setupApp } from './helpers.ts';

const envs: ReturnType<typeof setupApp>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const h of envs.splice(0)) { await h.snapshots.settled(); h.store.close(); }
});

function legacyCache() {
  const h = setupApp(); envs.push(h);
  const user = h.store.createUser({ username: 'owner', passwordHash: 'fixture', role: 'admin' });
  const token = h.store.userToken(user.id)!.token;
  const content = 'DOMAIN,example.test\nURL-REGEX,^https://example[.]test';
  const rs: RuleSetDoc = { id: 'r', name: '公共规则', sources: [{ id: 'local', kind: 'local', format: 'auto', content }] };
  h.store.put('ruleset', rs, user.id);
  const reference = { matcher: { kind: 'ruleset' as const, id: rs.id } }, target = { client: 'stash' as const };
  const delivery = { mode: 'managed' as const, format: 'text' as const, behavior: 'classical' as const };
  const hash = (value: unknown) => createHash('sha256').update(stableStringify(value)).digest('hex');
  // 固定升级前的身份、版本和正文；不能调用当前 register，否则会把旧正文标成新版本。
  const key = hash({ identity: { id: rs.id }, options: undefined, target, delivery });
  const inputHash = hash({ version: 2, rs, target, options: undefined, bodies: [content] });
  const body = 'DOMAIN,example.test\n# [Stash 尚未适配 URL-REGEX] URL-REGEX,^https://example[.]test\n';
  h.store.putSharedRule(key, rs.id, { reference, target, name: rs.name, delivery, inputHash, body } satisfies SharedRuleRecord);
  return { ...h, user, rs, reference, target, key, inputHash, body, expected: content + '\n',
    urls: { key: `/resources/ruleset?key=${key}&token=${token}`, id: `/resources/ruleset?id=${rs.id}&target=stash&token=${token}` } };
}

it.each(['key', 'id'] as const)('旧 Stash 公共规则通过 %s 链接按新语义重建，地址不变且随后命中缓存', async entry => {
  const h = legacyCache(), write = vi.spyOn(h.store, 'putSharedRule');
  expect(h.renderer.sharedRules.key(h.reference, h.target)).toBe(h.key);
  const response = await h.app.request(h.urls[entry]);
  expect(response.status).toBe(200);
  expect(await response.text()).toBe(h.expected);
  expect(response.headers.get('x-sub-forge-warning')).toBeNull();
  const rebuilt = h.store.getSharedRule<SharedRuleRecord>(h.key)!;
  expect(rebuilt.inputHash).not.toBe(h.inputHash);
  expect(rebuilt.body).toBe(h.expected);
  expect(h.store.listSharedRules()).toHaveLength(1);
  expect(write).toHaveBeenCalledTimes(1);
  for (const url of Object.values(h.urls)) {
    expect(await (await h.app.request(url)).text()).toBe(h.expected);
  }
  expect(write).toHaveBeenCalledTimes(1);
});

it('旧公共规则重建失败保留成功正文，恢复原输入后仍重试并清除告警', async () => {
  const h = legacyCache(), warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  h.store.put('ruleset', { ...h.rs, sources: [{ id: 'remote', kind: 'remote', format: 'srs', url: 'https://rules.test/unsupported.srs' }] }, h.user.id);
  const failed = await h.app.request(h.urls.key);
  expect(failed.status).toBe(200);
  expect(await failed.text()).toBe(h.body);
  expect(failed.headers.get('x-sub-forge-warning')).toBe('last-good-rule');
  expect(warning).toHaveBeenCalledOnce();
  expect(h.store.getSharedRule<SharedRuleRecord>(h.key)).toMatchObject({ inputHash: h.inputHash, body: h.body, error: expect.any(String) });
  h.store.put('ruleset', h.rs, h.user.id);
  const recovered = await h.app.request(h.urls.key);
  expect(recovered.status).toBe(200);
  expect(await recovered.text()).toBe(h.expected);
  expect(recovered.headers.get('x-sub-forge-warning')).toBeNull();
  expect(h.store.getSharedRule<SharedRuleRecord>(h.key)!.error).toBeUndefined();
});
