import { describe, expect, it } from 'vitest';
import { profileEditorOverlay } from '@sub-forge/core';
import type { ProfileDoc } from '../../hooks.ts';
import { acceptProfileSave, persistedProfile, syncProfileDraft, updateEditorOverlay } from './routing.ts';
const profile: ProfileDoc = { id: 'p', name: '配置', nodeSets: [], chains: [], overlay: {}, refPolicy: { default: 'wrap' }, routing: { mode: 'independent', config: {
  groups: [{ id: 'a', name: '甲', type: 'select', members: [{ kind: 'builtin', name: 'DIRECT' }], test: { interval: 300 } }, { id: 'b', name: '乙', type: 'fallback', members: [{ kind: 'group', groupId: 'a' }] }],
  rules: [{ id: 'r', matcher: { kind: 'rule', rule: { type: 'DOMAIN', value: 'test.local' } }, target: { kind: 'group', groupId: 'a' }, enabled: false, options: { noResolve: true } }], final: { kind: 'group', groupId: 'b' },
} } };
describe('订阅编辑器分流适配', () => {
  it('独立组编辑保留顺序、规则选项、节点引用与最终出口，持久化不带虚拟覆盖层', () => {
    const next = updateEditorOverlay(profile, o => ({ ...o, extraGroups: o.extraGroups!.map(e => ({ ...e, group: { ...e.group, name: `${e.group.name}改` } })) }));
    expect(next.routing?.mode).toBe('independent');
    if (next.routing?.mode !== 'independent' || profile.routing?.mode !== 'independent') throw new Error('模式错误');
    expect(next.routing.config.rules).toEqual(profile.routing.config.rules);
    expect(next.routing.config.final).toEqual(profile.routing.config.final);
    expect(next.routing.config.groups.map(g => g.name)).toEqual(['甲改', '乙改']);
    expect(next.routing.config.groups[1]!.members).toEqual([{ kind: 'group', groupId: 'a' }]);
    expect(persistedProfile({ ...next, overlay: profileEditorOverlay(next) }).overlay).toEqual({});
  });
  it('绑定组增删成员保存当前状态，多次保存不重复叠加', () => {
    const bound: ProfileDoc = { ...profile, routing: { mode: 'bound', templateId: 't', groupAdditions: {} } };
    const add = updateEditorOverlay(bound, o => ({ ...o, groupPatches: { a: { addMembers: [{ kind: 'nodeset', ref: { type: 'source', id: 's' } }] } } }));
    expect(updateEditorOverlay(add, o => o)).toEqual(add);
    const remove = updateEditorOverlay(add, () => ({}));
    expect(remove.routing).toEqual(bound.routing);
  });
});

it('后台刷新不覆盖转换草稿，保存期间的新输入保留并使用新 revision', () => {
  const initial = { ...profile, revision: 1 };
  const converted: ProfileDoc = { ...initial, routing: { mode: 'bound', templateId: 't', groupAdditions: {} } };
  const remote = { ...initial, revision: 2, name: '另一处编辑' };
  expect(syncProfileDraft(initial, initial, remote)).toBe(remote);
  expect(syncProfileDraft(converted, initial, remote)).toBe(converted);
  const saved = { ...converted, revision: 3 };
  expect(acceptProfileSave(converted, converted, saved)).toBe(saved);
  const typing = { ...converted, name: '保存期间继续编辑' };
  expect(acceptProfileSave(typing, converted, saved)).toEqual({ ...typing, revision: 3 });
  expect(syncProfileDraft(converted, remote, { ...remote, id: 'other' }).id).toBe('other');
});
