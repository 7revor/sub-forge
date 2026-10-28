// 模板自身校验（TPL-07 ① / TPL-11）。不通过则禁止发布；编辑器保存草稿时即时运行。

import { Report } from '../report.ts';
import type { RuleSetInputs } from '../rules/expand.ts';
import type { GroupMember, Target, Template } from '../types.ts';
import { findGroupCycles } from './merge.ts';

export function validateTemplate(t: Template, rules?: Pick<RuleSetInputs, 'rulesets' | 'bundles'>): Report {
  const report = new Report();
  const ids = new Map<string, number>();
  const names = new Map<string, number>();
  for (const g of t.groups) {
    ids.set(g.id, (ids.get(g.id) ?? 0) + 1);
    names.set(g.name, (names.get(g.name) ?? 0) + 1);
  }
  for (const [id, n] of ids) if (n > 1) report.error('template.duplicate-id', `组 ID ${id} 重复`, `group:${id}`);
  for (const [name, n] of names) if (n > 1) report.error('template.duplicate-name', `组名「${name}」重复`);

  const groupIds = new Set(t.groups.map((g) => g.id));
  const checkMember = (m: GroupMember, where: string) => {
    if (m.kind === 'builtin') return;
    if (m.kind === 'group') {
      if (!groupIds.has(m.groupId)) report.error('template.dangling-group', `引用的组 ${m.groupId} 不存在`, where);
      return;
    }
    report.error('template.node-in-template', '模板组的成员只能是模板组或内置策略，不能包含节点或节点集', where);
  };
  const checkTarget = (target: Target, where: string) => {
    if (target.kind === 'node') report.error('template.node-in-template', '模板中的出口只能是模板组或内置策略', where);
    else if (target.kind === 'group' && !groupIds.has(target.groupId)) report.error('template.dangling-group', `出口组 ${target.groupId} 不存在`, where);
  };

  for (const g of t.groups) {
    const where = `group:${g.id}`;
    g.members.forEach((m) => checkMember(m, where));
    if (g.filter || g.excludeFilter || g.excludeType) report.error('template.filter-in-template', `模板组「${g.name}」不能预设 filter / exclude-filter / exclude-type`, where);
  }
  for (const c of findGroupCycles(t.groups)) report.error('template.group-cycle', `组之间成环：${c.join(' → ')}`);

  const ruleIds = new Set<string>();
  for (const r of t.rules) {
    const where = `rule:${r.id}`;
    if (ruleIds.has(r.id)) report.error('template.duplicate-id', `规则 ID ${r.id} 重复`, where);
    ruleIds.add(r.id);
    checkTarget(r.target, where);
    if (!rules) continue;
    if (r.matcher.kind === 'ruleset' && !rules.rulesets[r.matcher.id]) report.error('template.dangling-ruleset', `规则集 ${r.matcher.id} 不存在`, where);
    if (r.matcher.kind === 'bundle') {
      const b = rules.bundles[r.matcher.id];
      if (!b) report.error('template.dangling-bundle', `规则包 ${r.matcher.id} 不存在`, where);
      else if (b.items.some((i) => (i as { kind: string }).kind === 'bundle')) report.error('bundle.nested', `规则包「${b.name}」超过两层`, where);
      else for (const i of b.items) if (i.kind === 'ruleset' && !rules.rulesets[i.id]) report.error('template.dangling-ruleset', `规则包「${b.name}」引用的规则集 ${i.id} 不存在`, where);
    }
  }

  if (!t.final) report.error('template.no-final', '未设置 MATCH / FINAL 出口');
  else checkTarget(t.final, 'final');
  return report;
}
