import { Hono } from 'hono';
import { Report, resolveProfileRouting, type GroupMember, type Target } from '@sub-forge/core';
import { independentProfile, profileTemplate } from '../profile-routing.ts';
import type { ProfileDoc } from '../docs.ts';
import type { Store } from '../store.ts';
import { bad, isStr, jsonBody, notFound, requireUser, type ApiEnv } from './common.ts';
import { validateDoc } from './validate.ts';

/** 转换仅生成可预览的草稿，最终通过保存接口提交。 */
export function profileConversionRoutes(store: Store) {
  const app = new Hono<ApiEnv>();
  app.post('/profiles/routing/convert', requireUser, async c => {
    const body = await jsonBody(c);
    if (!body.profile || typeof body.profile !== 'object' || Array.isArray(body.profile)) throw bad('需要订阅草稿');
    const raw = body.profile as Record<string, unknown>;
    const id = typeof raw.id === 'string' ? raw.id : '';
    if (id) {
      const saved = store.getWithOwner('profile', id);
      if (!saved || saved.owner !== c.get('user').id) throw notFound('配置订阅');
    }
    const profile = validateDoc('profile', raw, id, c.get('user'), store);
    const currentTemplate = profileTemplate(profile, (key, version) => store.getTemplate(key, version));
    if (body.mode === 'independent') {
      const next = independentProfile(profile, currentTemplate);
      return c.json({ item: next, changes: ['已将当前策略组、成员和规则完整复制到订阅，之后独立维护'] });
    }
    if (body.mode !== 'bound' || !isStr(body.templateId)) throw bad('请选择分流模式和模板');
    const template = store.getTemplate(body.templateId);
    if (!template) throw notFound('模板');
    const mapping = body.mapping;
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw bad('请指定策略组成员映射');
    const map = mapping as Record<string, unknown>;
    const ids = new Set(template.groups.map(g => g.id));
    const effective = resolveProfileRouting(profile, currentTemplate, new Report());
    const additions: Record<string, GroupMember[]> = Object.create(null);
    const changes: string[] = [];
    const destination = (old: string): string | null => {
      const mapped = map[old];
      if (mapped === null) return null;
      if (!isStr(mapped) || !ids.has(mapped)) throw bad(`请为策略组 ${old} 选择目标或明确选择不迁移`);
      return mapped;
    };
    const remapTarget = (target: Target): Target => {
      if (target.kind === 'group') {
        const next = destination(target.groupId);
        if (!next) throw bad('代理链或成员仍引用被移除的组，请先修改引用');
        return { ...target, groupId: next };
      }
      if (target.kind === 'node' && target.ref.fallback && target.ref.fallback !== 'error') return { ...target, ref: { ...target.ref, fallback: remapTarget(target.ref.fallback) } };
      return target;
    };
    for (const group of effective.groups) {
      const members = profile.routing?.mode === 'bound' ? profile.routing.groupAdditions[group.id] ?? [] : group.members.filter(m => ['node', 'nodeset', 'all'].includes(m.kind));
      if (!members.length) continue;
      const target = destination(group.id);
      if (!target) { changes.push(`移除「${group.name}」的 ${members.length} 个追加成员`); continue; }
      const remapped = members.map(m => m.kind === 'group' || m.kind === 'node' ? remapTarget(m) : m);
      additions[target] = [...(additions[target] ?? []), ...remapped];
      changes.push(`「${group.name}」的 ${members.length} 个成员迁移到「${template.groups.find(g => g.id === target)!.name}」`);
    }
    const { template: _old, ...rest } = profile;
    const next: ProfileDoc = { ...rest, overlay: {}, routing: { mode: 'bound', templateId: template.id, groupAdditions: additions, ...(profile.routing?.mode === 'bound' && profile.routing.prependRules ? { prependRules: profile.routing.prependRules.map(rule => ({ ...rule, target: remapTarget(rule.target) })) } : {}) },
      chains: profile.chains.map(chain => ({ ...chain, via: remapTarget(chain.via) })),
    };
    if (profile.routing?.mode === 'bound' && profile.routing.prependRules?.length) changes.push(`保留 ${profile.routing.prependRules.length} 条前置规则，并按策略组映射更新出口`);
    if (profile.routing?.mode === 'independent' && effective.groups.length) changes.push(`替换原策略组：${effective.groups.map(g => g.name).join('、')}；原有 ${effective.rules.length} 条规则改为模板的 ${template.rules.length} 条规则`);
    changes.unshift(`策略组结构、参数、规则和最终出口改用「${template.name ?? template.id}」`);
    validateDoc('profile', next as unknown as Record<string, unknown>, id, c.get('user'), store);
    return c.json({ item: next, changes });
  });
  app.get('/profiles/:id/migration-backup', requireUser, c => {
    const row = store.getWithOwner('profile', c.req.param('id'));
    if (!row || row.owner !== c.get('user').id) throw notFound('配置订阅');
    const backup = store.getProfileMigrationBackup(row.doc.id);
    if (!backup) throw notFound('迁移备份');
    return c.json({ item: backup });
  });
  return app;
}
