import { findGroupCycles, Report, resolveProfileRouting, type GroupSpec } from '@sub-forge/core';
import type { ProfileDoc } from '../docs.ts';
import type { Store } from '../store.ts';
import { profileTemplate } from '../profile-routing.ts';
import { checkRuleSetReference } from '../ruleset-reference.ts';
import { bad, HttpError, isStr } from './common.ts';
import type { RefChecker } from './validate.ts';

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const builtins = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS']);

export function validateProfileRouting(doc: ProfileDoc, store: Store, refs: RefChecker): void {
  const r = doc.routing;
  if (!obj(r) || !['bound', 'independent'].includes(r.mode)) throw bad('分流模式只能是 bound 或 independent');
  if (doc.template !== undefined || Object.keys(doc.overlay).length) throw bad('新分流模式不能同时保存旧模板引用或覆盖层');
  let template;
  if (r.mode === 'bound') {
    if (Object.keys(r).some(k => !['mode', 'templateId', 'groupAdditions'].includes(k))) throw bad('绑定模式只能保存模板引用和追加成员');
    if (!isStr(r.templateId) || !(template = store.getTemplate(r.templateId))) throw bad('模板不存在');
    if (doc.templateVersion !== template.version) throw new HttpError(409, '模板已更新，请重新加载后检查并保存');
    if (!obj(r.groupAdditions)) throw bad('追加成员必须按策略组 ID 保存');
    for (const [id, members] of Object.entries(r.groupAdditions)) {
      if (!template.groups.some(g => g.id === id)) throw bad(`追加成员指向不存在的策略组 ${id}`);
      if (!Array.isArray(members)) throw bad(`策略组 ${id} 的追加成员必须是数组`);
    }
    doc.templateVersion = template.version;
  } else {
    if (Object.keys(r).some(k => !['mode', 'config', 'initializedFrom'].includes(k))) throw bad('独立模式字段不合法');
    if (!obj(r.config) || !Array.isArray(r.config.groups) || !Array.isArray(r.config.rules) || !obj(r.config.final)) throw bad('独立配置需要完整的策略组、规则和最终出口');
    if (Object.keys(r.config).some(k => !['groups', 'rules', 'final'].includes(k))) throw bad('独立分流配置字段不合法');
  }
  const report = new Report();
  const effective = resolveProfileRouting(doc, template, report);
  if (report.hasErrors) throw bad(report.items.map(i => i.message).join('；'));
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const group of effective.groups) {
    if (!obj(group) || !isStr(group.id) || !isStr(group.name) || !Array.isArray(group.members) || !['select', 'url-test', 'fallback', 'load-balance'].includes(group.type)) throw bad('策略组格式错误');
    if (ids.has(group.id) || names.has(group.name)) throw bad('策略组 ID 或名称重复');
    ids.add(group.id); names.add(group.name);
  }
  const nodeSet = (value: unknown, where: string) => {
    const ref = refs.nodeSet(value, where);
    if (!doc.nodeSets.some(n => n.ref.type === ref.type && n.ref.id === ref.id)) throw bad(`${where}：节点集未加入本订阅`);
  };
  const target = (value: unknown, where: string, depth = 0): void => {
    if (depth > 20 || !obj(value)) throw bad(`${where}：引用格式错误`);
    if (value.kind === 'builtin' && builtins.has(value.name as string)) return;
    if (value.kind === 'group' && ids.has(value.groupId as string)) return;
    if (value.kind === 'node' && obj(value.ref) && obj(value.ref.match)) {
      nodeSet(value.ref.nodeSet, where);
      const match = value.ref.match;
      if (!isStr(match.exact) && !isStr(match.regex)) throw bad(`${where}：节点匹配条件不能为空`);
      if (value.ref.fallback && value.ref.fallback !== 'error') target(value.ref.fallback, where, depth + 1);
      return;
    }
    throw bad(`${where}：引用不存在的策略组或不合法的出口`);
  };
  for (const group of effective.groups) for (const member of group.members) {
    if (!obj(member)) throw bad(`策略组「${group.name}」成员格式错误`);
    if (member.kind === 'nodeset') nodeSet(member.ref, group.name);
    else if (member.kind === 'all' && ['all', 'proxies', 'providers'].includes(member.scope)) continue;
    else target(member, group.name);
  }
  if (findGroupCycles(effective.groups as GroupSpec[]).length) throw bad('策略组引用成环');
  const previous = doc.id ? store.get('profile', doc.id) : undefined;
  const priorRules = previous ? resolveProfileRouting(previous, profileTemplate(previous, (id, v) => store.getTemplate(id, v)), new Report()).rules : [];
  const ruleIds = new Set<string>();
  for (const rule of effective.rules) {
    if (!obj(rule) || !isStr(rule.id) || !obj(rule.matcher) || ruleIds.has(rule.id)) throw bad('规则格式错误或 ID 重复');
    ruleIds.add(rule.id);
    target(rule.target, `规则 ${rule.id}`);
    if (rule.matcher.kind === 'ruleset') {
      // 模板内容由管理员发布；独立复制保留原引用的仓库映射。
      const prior = priorRules.find(p => p.id === rule.id)?.matcher;
      if (r.mode === 'independent') {
        checkRuleSetReference(rule.matcher, store, prior?.kind === 'ruleset' ? prior : undefined);
        if (!rule.matcher.repository && !rule.matcher.remote && !refs.ruleVisible(rule.matcher.id)) throw bad(`规则 ${rule.id}：规则集不存在`);
      }
    } else if (rule.matcher.kind !== 'rule' || !obj(rule.matcher.rule) || !isStr(rule.matcher.rule.type)) throw bad(`规则 ${rule.id}：匹配项不合法`);
  }
  target(effective.final, '最终出口');
  for (const chain of doc.chains) target(chain.via, `代理链 ${chain.id}`);
}
