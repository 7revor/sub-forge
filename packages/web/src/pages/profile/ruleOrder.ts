import type { Overlay, RuleEntry } from '@sub-forge/core';

export type RuleRow = RuleEntry & { origin: 'template' | 'profile' };
export type ExtraRule = NonNullable<Overlay['extraRules']>[number];

/** 与内核逐条插入的语义一致；禁用的模板规则仍占据锚点位置。 */
export function mergeRuleRows(templateRules: RuleEntry[], overlay: Overlay): RuleRow[] {
  const rows: RuleRow[] = templateRules.map((rule) => {
    const patch = overlay.rulePatches?.[rule.id];
    return { ...rule, origin: 'template',
      ...(patch?.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch?.target ? { target: patch.target } : {}),
    };
  });
  for (const { anchor, rule } of overlay.extraRules ?? []) {
    const row: RuleRow = { ...rule, origin: 'profile' };
    if (anchor === 'top') rows.unshift(row);
    else if (anchor === 'bottom') rows.push(row);
    else {
      const at = rows.findIndex((r) => r.id === ('before' in anchor ? anchor.before : anchor.after));
      if (at >= 0) rows.splice('before' in anchor ? at : at + 1, 0, row);
    }
  }
  return rows;
}

/** 按连续私有区段生成锚点；同一 after 要倒序插入，before 则按显示顺序插入。 */
export function ruleRowsToExtraRules(rows: RuleRow[], previous: ExtraRule[] = []): ExtraRule[] {
  const extras: ExtraRule[] = [];
  let previousTemplate: string | undefined;
  let at = 0;
  while (at < rows.length) {
    const row = rows[at]!;
    if (row.origin === 'template') { previousTemplate = row.id; at++; continue; }
    const start = at;
    while (at < rows.length && rows[at]!.origin === 'profile') at++;
    const nextTemplate = rows[at]?.id;
    const run = rows.slice(start, at).map(({ origin: _, ...rule }) => rule);
    if (previousTemplate !== undefined) {
      extras.push(...run.reverse().map((rule) => ({ anchor: { after: previousTemplate! }, rule })));
    } else if (nextTemplate !== undefined) {
      extras.push(...run.map((rule) => ({ anchor: { before: nextTemplate }, rule })));
    } else {
      extras.push(...run.map((rule, i): ExtraRule => ({ anchor: i === 0 ? 'top' : 'bottom', rule })));
    }
  }
  const visible = new Set(extras.map((extra) => extra.rule.id));
  const original = new Map(previous.map((extra) => [extra.rule.id, extra]));
  return [
    // 失效锚点保留在有效条目前，避免指向尚未插入私有规则的条目被意外激活。
    ...previous.filter((extra) => !visible.has(extra.rule.id)),
    ...extras.map((extra) => ({ ...original.get(extra.rule.id), ...extra })),
  ];
}
