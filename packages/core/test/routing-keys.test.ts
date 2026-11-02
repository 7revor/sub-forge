import { expect, it } from 'vitest';
import { Report, resolveProfileRouting, routingConfig, withGroupHidden, type ProfileRouting, type Template } from '../src/index.ts';

const direct = { kind: 'builtin' as const, name: 'DIRECT' as const };
const reject = { kind: 'builtin' as const, name: 'REJECT' as const };
const ids = ['constructor', 'toString', '__proto__'];
const template = (id: string, hidden = false): Template => ({ id: 't', groups: [{ id, name: '策略组', type: 'select', members: [direct], display: { hidden } }], rules: [], final: direct });
const bound = (): Extract<ProfileRouting, { mode: 'bound' }> => ({ mode: 'bound', templateId: 't', groupAdditions: {} });

it.each(ids)('特殊组 ID %s 没有自身覆盖时跟随模板，不读取对象原型', id => {
  const report = new Report();
  const effective = routingConfig(resolveProfileRouting({ routing: bound() }, template(id), report));
  expect(effective.groups).toEqual(template(id).groups);
  expect(report.items).toEqual([]);
});

it.each(ids)('特殊组 ID %s 的追加成员及 false 隐藏覆盖在 JSON 往返后仍有效', id => {
  const routing = JSON.parse(JSON.stringify({ ...bound(), groupAdditions: { [id]: [reject] }, groupHidden: { [id]: false } }));
  const effective = resolveProfileRouting({ routing }, template(id, true), new Report());
  expect(effective.groups[0]?.members).toEqual([direct, reject]);
  expect(effective.groups[0]?.display?.hidden).toBe(false);
});

it.each(ids)('特殊组 ID %s 可隐藏、恢复跟随，并可显式覆盖为 false', id => {
  const hidden = withGroupHidden(bound(), template(id), id, true);
  expect(Object.hasOwn(hidden.groupHidden!, id)).toBe(true);
  expect(JSON.parse(JSON.stringify(hidden)).groupHidden[id]).toBe(true);
  expect(withGroupHidden(hidden, template(id), id, false)).not.toHaveProperty('groupHidden');
  const shown = withGroupHidden(bound(), template(id, true), id, false);
  expect(Object.hasOwn(shown.groupHidden!, id)).toBe(true);
  expect(shown.groupHidden![id]).toBe(false);
  expect(Object.getPrototypeOf(shown.groupHidden)).toBe(Object.prototype);
});
