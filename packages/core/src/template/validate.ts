// 模板自身校验（TPL-07 ① / TPL-11）。不通过则禁止发布；编辑器保存草稿时即时运行。

import { Report } from '../report.ts';
import type { RuleSetInputs } from '../rules/expand.ts';
import type { GroupMember, RuleIR, Target, Template } from '../types.ts';
import { findGroupCycles } from './merge.ts';
import { rawRuleError } from '../rules/raw.ts';
import { normalizeRuleUrl } from '../rules/remote.ts';

export function validateTemplate(t: Template, rules?: Pick<RuleSetInputs, 'rulesets'>): Report {
  const report = new Report();
  if (t.ruleProviders !== undefined) {
    const providerNames = new Set<string>();
    if (!Array.isArray(t.ruleProviders)) report.error('template.invalid-provider', '远程规则来源必须是列表');
    else for (const p of t.ruleProviders) {
      try {
        if (!p || typeof p.name !== 'string' || !p.name.trim() || p.name.includes(',')) throw new Error('远程规则来源名称不能为空或包含逗号');
        if (providerNames.has(p.name)) throw new Error(`远程规则来源「${p.name}」重复`);
        providerNames.add(p.name);
        normalizeRuleUrl(p.url);
      } catch (error) {
        report.error('template.invalid-provider', error instanceof Error ? error.message : String(error));
      }
    }
  }
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
  }
  for (const c of findGroupCycles(t.groups)) report.error('template.group-cycle', `组之间成环：${c.join(' → ')}`);

  const ruleIds = new Set<string>();
  const checkRule = (rule: RuleIR, where: string) => {
    if (rule.type === 'RAW') {
      if (typeof rule.text !== 'string') { report.error('template.invalid-raw-rule', 'RAW 内容必须是字符串', where); return; }
      const error = rawRuleError(rule.text);
      if (error) report.error('template.invalid-raw-rule', error, where);
      if (rule.client !== undefined && !['mihomo', 'surge', 'stash'].includes(rule.client)) report.error('template.invalid-raw-client', 'RAW 客户端不合法', where);
    } else if (rule.type === 'AND' || rule.type === 'OR' || rule.type === 'NOT') rule.children.forEach(child => checkRule(child, where));
  };
  for (const r of t.rules) {
    const where = `rule:${r.id}`;
    if (ruleIds.has(r.id)) report.error('template.duplicate-id', `规则 ID ${r.id} 重复`, where);
    ruleIds.add(r.id);
    checkTarget(r.target, where);
    if (r.matcher.kind === 'rule') {
      checkRule(r.matcher.rule, where);
      r.matcher.overrides?.forEach(({ action }) => {
        if ('replace' in action) action.replace.forEach(rule => checkRule(rule, where));
        else if ('append' in action) action.append.forEach(rule => checkRule(rule, where));
      });
    }
    if (!rules) continue;
    if (r.matcher.kind === 'ruleset' && !rules.rulesets[r.matcher.id]) report.error('template.dangling-ruleset', `规则集 ${r.matcher.id} 不存在`, where);
  }

  if (!t.final) report.error('template.no-final', '未设置 MATCH / FINAL 出口');
  else checkTarget(t.final, 'final');
  return report;
}
