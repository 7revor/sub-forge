// 模板 ⊕ 覆盖层合并（docs/03 §5）。Profile 只保存覆盖层，渲染时合并，模板更新自动生效。

import type { Report } from '../report.ts';
import type { GroupSpec, ID, Overlay, RuleEntry, Target, Template } from '../types.ts';

export type EffectiveGroup = GroupSpec & { origin: 'template' | 'profile' };
export type EffectiveRule = RuleEntry & { origin: 'template' | 'profile' };

export type Effective = {
  groups: EffectiveGroup[];
  rules: EffectiveRule[];
  final: Target;
};

/** Profile 不能改模板组的这些属性（Q6 / PRF-09） */
const FORBIDDEN_SET_KEYS = ['name'] as const;

export function mergeTemplate(template: Template | undefined, overlay: Overlay, report: Report): Effective {
  const tplGroups = template?.groups ?? [];
  const tplRules = template?.rules ?? [];
  const groupIds = new Set(tplGroups.map((g) => g.id));
  const ruleIds = new Set(tplRules.map((r) => r.id));

  // ---- 组 ----
  for (const id of Object.keys(overlay.groupPatches ?? {})) {
    if (!groupIds.has(id)) report.warn('overlay.orphan', `覆盖项指向的模板组 ${id} 已不存在，不再输出`, `group:${id}`);
  }
  const groups: EffectiveGroup[] = tplGroups.map((g) => {
    const p = overlay.groupPatches?.[g.id];
    if (!p) return { ...g, origin: 'template' };
    const set: Partial<GroupSpec> = { ...(p.set ?? {}) };
    for (const k of FORBIDDEN_SET_KEYS) {
      if (k in set) { report.error('overlay.forbidden', `模板组「${g.name}」不能在 Profile 中改名`, `group:${g.id}`); delete set[k]; }
    }
    if (set.display?.hidden) {
      report.error('overlay.forbidden', `模板组「${g.name}」不能在 Profile 中隐藏`, `group:${g.id}`);
      set.display = { ...set.display, hidden: false };
    }
    const add = p.addMembers ?? [];
    const members = p.memberOrder === 'prepend' ? [...add, ...g.members] : [...g.members, ...add];
    return { ...g, ...set, id: g.id, name: g.name, members, origin: 'template' };
  });
  for (const { after, group } of overlay.extraGroups ?? []) {
    const eg: EffectiveGroup = { ...group, origin: 'profile' };
    const at = after === undefined ? -1 : groups.findIndex((g) => g.id === after);
    if (after !== undefined && at < 0) report.warn('overlay.orphan-anchor', `私有组「${group.name}」的锚点 ${after} 已不存在，放到末尾`, `group:${group.id}`);
    if (at < 0) groups.push(eg); else groups.splice(at + 1, 0, eg);
  }

  // ---- 规则 ----
  for (const id of Object.keys(overlay.rulePatches ?? {})) {
    if (!ruleIds.has(id)) report.warn('overlay.orphan', `覆盖项指向的模板规则 ${id} 已不存在，不再输出`, `rule:${id}`);
  }
  const rules: EffectiveRule[] = tplRules.map((r) => {
    const p = overlay.rulePatches?.[r.id];
    const eff: EffectiveRule = { ...r, origin: 'template' };
    if (p?.enabled !== undefined) eff.enabled = p.enabled;
    if (p?.target) eff.target = p.target;
    return eff;
  });
  for (const { anchor, rule } of overlay.extraRules ?? []) {
    const er: EffectiveRule = { ...rule, origin: 'profile' };
    if (anchor === 'top') { rules.unshift(er); continue; }
    if (anchor === 'bottom') { rules.push(er); continue; }
    const id = 'before' in anchor ? anchor.before : anchor.after;
    const at = rules.findIndex((r) => r.id === id);
    if (at < 0) {
      report.warn('overlay.orphan', `私有规则 ${rule.id} 的锚点 ${id} 已不存在，不再输出`, `rule:${rule.id}`);
      continue;
    }
    rules.splice('before' in anchor ? at : at + 1, 0, er);
  }

  const final = overlay.final ?? template?.final ?? { kind: 'builtin', name: 'DIRECT' };
  return { groups, rules, final };
}

/** 在有效组之间找环（组嵌套成员）。返回组 ID 环列表 */
export function findGroupCycles(groups: Pick<GroupSpec, 'id' | 'members'>[]): ID[][] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const cycles: ID[][] = [];
  const state = new Map<ID, 'visiting' | 'done'>();
  const stack: ID[] = [];
  const visit = (id: ID) => {
    const s = state.get(id);
    if (s === 'done') return;
    if (s === 'visiting') { cycles.push([...stack.slice(stack.indexOf(id)), id]); return; }
    state.set(id, 'visiting');
    stack.push(id);
    for (const m of byId.get(id)?.members ?? []) if (m.kind === 'group' && byId.has(m.groupId)) visit(m.groupId);
    stack.pop();
    state.set(id, 'done');
  };
  for (const g of groups) visit(g.id);
  return cycles;
}
