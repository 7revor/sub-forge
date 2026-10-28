import type { Overlay, Template } from '@sub-forge/core';

/** 与内核逐项插入保持一致：私有锚点可以引用此前已插入的私有组或规则。 */
export function findOverlayOrphans(overlay: Overlay, template?: Pick<Template, 'groups' | 'rules'>) {
  const groups = new Set(template?.groups.map((g) => g.id));
  const rules = new Set(template?.rules.map((r) => r.id));
  const groupPatches = Object.keys(overlay.groupPatches ?? {}).filter((id) => !groups.has(id));
  const rulePatches = Object.keys(overlay.rulePatches ?? {}).filter((id) => !rules.has(id));
  const extraGroups: string[] = [];
  const extraRules: string[] = [];
  for (const { after, group } of overlay.extraGroups ?? []) {
    if (after !== undefined && !groups.has(after)) extraGroups.push(group.id);
    // 孤儿组仍被内核追加到末尾，后续私有组可以继续引用它。
    groups.add(group.id);
  }
  for (const { anchor, rule } of overlay.extraRules ?? []) {
    if (typeof anchor !== 'string' && !rules.has('before' in anchor ? anchor.before : anchor.after)) extraRules.push(rule.id);
    else rules.add(rule.id);
  }
  return { groupPatches, rulePatches, extraGroups, extraRules };
}
