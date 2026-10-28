import { mergeTemplate, Report, type Overlay, type RuleEntry, type Template } from '@sub-forge/core';
import { describe, expect, it } from 'vitest';
import { mergeRuleRows, ruleRowsToExtraRules, type RuleRow } from './ruleOrder.ts';

const rule = (id: string): RuleEntry => ({ id, matcher: { kind: 'rule', rule: { type: 'DOMAIN', value: `${id}.example` } }, target: { kind: 'builtin', name: 'DIRECT' } });
const row = (id: string): RuleRow => ({ ...rule(id), origin: id.startsWith('t') ? 'template' : 'profile' });
const template = (rules: RuleEntry[]): Template => ({ id: 'template', version: 1, groups: [], rules, final: { kind: 'builtin', name: 'DIRECT' } });

function roundtrip(ids: string[]) {
  const rows = ids.map(row);
  const original = structuredClone(rows);
  const templateRules = rows.filter((r) => r.origin === 'template').map(({ origin: _, ...r }) => r);
  const extraRules = ruleRowsToExtraRules(rows);
  expect(mergeRuleRows(templateRules, { extraRules })).toEqual(rows);
  expect(mergeTemplate(template(templateRules), { extraRules }, new Report()).rules).toEqual(rows);
  expect(rows).toEqual(original);
  expect(extraRules.every((e) => !('origin' in e.rule))).toBe(true);
  return extraRules;
}

describe('私有规则排序与锚点往返', () => {
  it('多条连续私有规则在同一 after 锚点反向写入', () => {
    const extras = roundtrip(['t1', 'p1', 'p2', 'p3', 't2']);
    expect(extras.map((e) => e.rule.id)).toEqual(['p3', 'p2', 'p1']);
    expect(extras.map((e) => e.anchor)).toEqual([{ after: 't1' }, { after: 't1' }, { after: 't1' }]);
  });
  it('开头的私有规则按 before 正向写入', () => {
    const extras = roundtrip(['p1', 'p2', 't1', 't2']);
    expect(extras.map((e) => e.rule.id)).toEqual(['p1', 'p2']);
    expect(extras.map((e) => e.anchor)).toEqual([{ before: 't1' }, { before: 't1' }]);
  });
  it('结尾仍锚定最后一条模板规则', () => {
    expect(roundtrip(['t1', 't2', 'p1', 'p2']).map((e) => e.anchor)).toEqual([{ after: 't2' }, { after: 't2' }]);
  });
  it('夹在不同模板规则之间的多个区段互不影响', () => {
    roundtrip(['p0', 't1', 'p1', 'p2', 't2', 'p3', 'p4', 't3', 'p5']);
  });
  it('没有模板规则时首条为 top，其余按顺序追加 bottom', () => {
    expect(roundtrip(['p3', 'p1', 'p2']).map((e) => e.anchor)).toEqual(['top', 'bottom', 'bottom']);
    roundtrip(['p1']);
    roundtrip([]);
  });
  it('只有模板规则时不生成私有规则', () => { expect(roundtrip(['t1', 't2'])).toEqual([]); });
  it('拖拽保留失效锚点及未识别字段，不会意外激活未显示的私有规则', () => {
    const previous = [
      { anchor: { after: 'p1' }, rule: rule('hidden') },
      { anchor: { before: 'missing' }, rule: rule('orphan') },
      { anchor: 'bottom' as const, rule: rule('p1'), future: '保留' },
    ];
    const templates = [rule('t1')];
    const visible = mergeRuleRows(templates, { extraRules: previous });
    expect(visible.map((r) => r.id)).toEqual(['t1', 'p1']);
    const reordered = [visible[1]!, visible[0]!];
    const extraRules = ruleRowsToExtraRules(reordered, previous);
    expect(extraRules.slice(0, 2)).toEqual(previous.slice(0, 2));
    expect(extraRules[2]).toEqual({ ...previous[2], anchor: { before: 't1' } });
    expect(mergeRuleRows(templates, { extraRules })).toEqual(reordered);
    expect(mergeTemplate(template(templates), { extraRules }, new Report()).rules).toEqual(reordered);
  });
  it('现有 top、bottom、before、after 与失效锚点和内核一致', () => {
    const overlay: Overlay = { extraRules: [
      { anchor: 'top', rule: rule('p1') }, { anchor: 'top', rule: rule('p2') },
      { anchor: { before: 't1' }, rule: rule('p3') }, { anchor: { before: 't1' }, rule: rule('p4') },
      { anchor: { after: 't1' }, rule: rule('p5') }, { anchor: { after: 't1' }, rule: rule('p6') },
      { anchor: 'bottom', rule: rule('p7') }, { anchor: 'bottom', rule: rule('p8') },
      { anchor: { after: 'missing' }, rule: rule('hidden') },
    ] };
    const rows = mergeRuleRows([rule('t1')], overlay);
    expect(rows.map((r) => r.id)).toEqual(['p2', 'p1', 'p3', 'p4', 't1', 'p6', 'p5', 'p7', 'p8']);
    expect(rows).toEqual(mergeTemplate(template([rule('t1')]), overlay, new Report()).rules);
    roundtrip(rows.map((r) => r.id));
  });
  it('排序不丢出口、启用状态、选项、客户端覆盖及未识别字段', () => {
    const privateRule = { ...rule('p1'), enabled: false, options: { noResolve: true, src: true }, future: { value: 1 },
      matcher: { kind: 'rule' as const, rule: { type: 'GEOIP' as const, value: 'cn' }, overrides: [{ when: { client: 'surge' as const }, action: { drop: true as const } }] } };
    const overlay: Overlay = { rulePatches: { t1: { enabled: false, target: { kind: 'builtin', name: 'REJECT' } } }, extraRules: [{ anchor: 'bottom', rule: privateRule }] };
    const rows = mergeRuleRows([rule('t1')], overlay);
    const extras = ruleRowsToExtraRules(rows);
    expect(extras[0]!.rule).toEqual(privateRule);
    expect(mergeRuleRows([rule('t1')], { ...overlay, extraRules: extras })).toEqual(rows);
    expect(rows).toEqual(mergeTemplate(template([rule('t1')]), overlay, new Report()).rules);
  });
  it('私有规则越过模板规则的每个落点均可往返，模板相对顺序不变', () => {
    const ids = ['p1', 't1', 'p2', 't2', 'p3'];
    for (const id of ['p1', 'p2', 'p3']) {
      for (let to = 0; to < ids.length; to++) {
        const moved = ids.filter((x) => x !== id);
        moved.splice(to, 0, id);
        roundtrip(moved);
        expect(moved.filter((x) => x.startsWith('t'))).toEqual(['t1', 't2']);
      }
    }
  });
});
