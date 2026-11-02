import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { ProfileDoc, TemplateDoc } from '../../hooks.ts';
import { chainCheckOptions, chainCheckSnapshot } from './chainCheckQuery.ts';

const template: TemplateDoc = { id: 't', name: '模板', groups: [{ id: 'g', name: '前置', type: 'select', members: [{ kind: 'builtin', name: 'DIRECT' }] }], rules: [], final: { kind: 'group', groupId: 'g' } };
const profile: ProfileDoc = { id: 'p', name: '订阅', nodeSets: [], chains: [], routing: { mode: 'bound', templateId: 't', groupAdditions: {} } };
afterEach(() => vi.unstubAllGlobals());

it('绑定模板没有版本号时，内容刷新自动触发新诊断并替换旧结果', async () => {
  let calls = 0;
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true, yaml: `诊断 ${++calls}`, report: [] })));
  const cache = new QueryClient();
  const observer = new QueryObserver(cache, chainCheckOptions(chainCheckSnapshot(profile, template)));
  const stop = observer.subscribe(() => {});
  try {
    await vi.waitFor(() => expect(observer.getCurrentResult().data?.yaml).toBe('诊断 1'));
    const changed = { ...template, groups: template.groups.map(group => ({ ...group, members: [{ kind: 'builtin' as const, name: 'REJECT' as const }] })) };
    observer.setOptions(chainCheckOptions(chainCheckSnapshot(profile, changed)));
    expect(observer.getCurrentResult().data).toBeUndefined();
    await vi.waitFor(() => expect(observer.getCurrentResult().data?.yaml).toBe('诊断 2'));
    expect(calls).toBe(2);
  } finally { stop(); cache.clear(); }
});

it('独立订阅不依赖模板，模板管理名称变化不触发分流诊断', () => {
  const independent: ProfileDoc = { ...profile, routing: { mode: 'independent', config: { groups: [], rules: [], final: template.final } } };
  expect(chainCheckSnapshot(independent, template)).toBe(chainCheckSnapshot(independent, undefined));
  expect(chainCheckSnapshot(profile, template)).toBe(chainCheckSnapshot(profile, { ...template, name: '只改管理名称' }));
  expect(chainCheckSnapshot(profile, undefined)).not.toBe(chainCheckSnapshot(profile, template));
});
