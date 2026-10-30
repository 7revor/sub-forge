import { normalizeRulePresence } from '../rule-presence.ts';
// 模板：所有人可读，管理员直接保存。保存时检查模板与绑定订阅：
//   ① 模板自身：不通过不能保存；
//   ② 对现有 Profile 的影响：逐个用新版本试渲染，会渲染失败的为阻断项（必须先修复冲突），
//      出现孤儿覆盖项或空组的为警告。
// 草稿只存在于前端，编辑时调用 validate 即时检查（TPL-11）。

import { ruleSetDelivery, parseRuleSourceContent, rejectedRuleReport, validateTemplate, sourceLabel, type ReportItem, type Template } from '@sub-forge/core';
import { readPagination } from './pagination.ts';
import { Hono, type Context } from 'hono';
import { randomId } from '../crypto.ts';
import type { RuleSetDoc, TemplateVersionDoc } from '../docs.ts';
import type { RenderService } from '../render.ts';
import { unusableBody, type SnapshotService } from '../snapshots.ts';
import type { Store, User } from '../store.ts';
import { bad, HttpError, isStr, jsonBody, notFound, requireAdmin, requireUser, type ApiEnv } from './common.ts';
import { checkRuleSetReference, resolveRuleSetReference } from '../ruleset-reference.ts';
import { RefChecker } from './validate.ts';

export type ImpactEntry = { profileId: string; profileName: string; owner: string | null; level: 'error' | 'warn'; forceable?: boolean; issues: ReportItem[] };

/** 只关心新版本带来的问题：渲染错误、孤儿覆盖项、空组 */
const IMPACT_CODES = new Set(['overlay.orphan', 'overlay.orphan-anchor', 'group.empty']);

async function selfCheck(store: Store, snapshots: SnapshotService, t: Template, user: User): Promise<ReportItem[]> {
  const rulesets: Record<string, RuleSetDoc> = Object.fromEntries(store.list('ruleset').map((r) => [r.id, r]));
  const referenceIssues: ReportItem[] = [];
  const prior = store.getTemplate(t.id);
  for (const rule of t.rules) {
    if (rule.matcher.kind !== 'ruleset') continue;
    const matcher = rule.matcher;
    try {
      const old = prior?.rules.find(r => r.matcher.kind === 'ruleset' && r.matcher.id === matcher.id)?.matcher;
      checkRuleSetReference(rule.matcher, store, old?.kind === 'ruleset' ? old : undefined);
      // 无归属种子保持兼容；有归属的本地规则必须符合公共/本人可见性。
      if (!matcher.repository && !matcher.remote && store.getWithOwner('ruleset', matcher.id)?.owner && !new RefChecker(store, user).ruleVisible(matcher.id)) throw bad('本地规则集不可用');
      const rs = resolveRuleSetReference(rule.matcher, store);
      if (rs) rulesets[rs.id] = rs;
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      referenceIssues.push({ level: 'error', code: 'template.ruleset-reference', message: error.message, where: `rule:${rule.id}` });
    }
  }
  if (referenceIssues.length) return referenceIssues;
  const report = validateTemplate(t, { rulesets }).items;
  if (report.some(i => i.level === 'error')) return report;
  const ids = new Set<string>();
  for (const r of t.rules) if (r.enabled !== false && r.matcher.kind === 'ruleset') ids.add(r.matcher.id);
  for (const id of ids) {
    const rs = rulesets[id]!;
    const where = `ruleset:${id}`;
    // 二进制只有无需处理的单来源可以透传；保存前也必须执行相同约束。
    if (rs.sources.some(src => src.enabled !== false && (src.format === 'mrs' || src.format === 'srs'))) {
      for (const entry of t.rules.filter(r => r.enabled !== false && r.matcher.kind === 'ruleset' && r.matcher.id === id)) {
        const delivery = ruleSetDelivery(rs, { rulesets, snapshots: {} }, { client: 'mihomo' }, entry.options);
        if (delivery.mode === 'unsupported') report.push({ level: 'error', code: 'template.ruleset-invalid', message: delivery.reason, where });
      }
    }
    for (const src of rs.sources) {
      if (src.enabled === false) continue;
      const label = `规则集「${rs.name}」的来源「${sourceLabel(src)}」`;
      if (src.format === 'srs') {
        report.push({ level: 'error', code: 'template.ruleset-invalid', message: `${label}暂不支持 SRS 托管`, where });
        continue;
      }
      let content = src.content ?? '';
      if (src.kind === 'remote') {
        const result = await snapshots.get('ruleset', id, src.url!, { ...src.fetch, format: src.format, behavior: src.behavior, scope: src.repository && !src.fetch?.ua ? 'public-repository' : store.getWithOwner('ruleset', id)?.owner ?? 'public-template' });
        if (!result.snapshot) {
          report.push({ level: 'error', code: 'template.ruleset-unavailable', message: `${label}没有可用快照：${result.error ?? '无法拉取'}`, where });
          continue;
        }
        content = result.snapshot.body ?? '';
        if (result.error || result.stale) report.push({ level: 'warn', code: 'template.ruleset-snapshot', message: `${label}使用可用快照${result.error ? `：${result.error}` : '，后台刷新中'}`, where });
      }
      if (src.format === 'mrs') {
        if (!content.startsWith('#subforge-binary-mrs\n')) report.push({ level: 'error', code: 'template.ruleset-invalid', message: `${label}没有有效的托管 MRS 内容`, where });
        continue;
      }
      const reason = unusableBody('ruleset', id, content, src.format);
      if (reason) {
        report.push({ level: 'error', code: 'template.ruleset-invalid', message: `${label}不可用：${reason}`, where });
        continue;
      }
      const parsed = parseRuleSourceContent(content, src);
      if (!parsed.passthrough && parsed.rejected.length) report.push({ level: 'warn', code: 'template.ruleset-rejected-lines', ...rejectedRuleReport(content, src, rs.sources.indexOf(src)), where });
    }
  }
  // 保留资源诊断，同时提供可直接展开定位的规则行错误。
  return report.flatMap(issue => issue.where?.startsWith('ruleset:')
    ? [issue, ...t.rules.filter(r => r.enabled !== false && r.matcher.kind === 'ruleset' && `ruleset:${r.matcher.id}` === issue.where).map(r => ({ ...issue, where: `rule:${r.id}` }))]
    : [issue]);
}

function draftFrom(body: Record<string, unknown>, id: string): TemplateVersionDoc {
  if (!isStr(body.name)) throw bad('name 不能为空');
  if (!Array.isArray(body.groups) || !Array.isArray(body.rules) || !body.final || typeof body.final !== 'object') throw bad('需要 groups、rules 与 final');
  return normalizeRulePresence('template', { id, name: body.name, groups: body.groups, rules: body.rules, final: body.final, ...(body.ruleProviders !== undefined ? { ruleProviders: body.ruleProviders } : {}) } as TemplateVersionDoc);
}

export function templateRoutes(store: Store, renderer: RenderService, snapshots: SnapshotService) {
  const app = new Hono<ApiEnv>();

  app.get('/templates', requireUser, (c) => {
    const options = readPagination(c.req.query());
    return c.json(options ? store.listLatestTemplatesPage(options) : { items: store.listLatestTemplates() });
  });

  app.get('/templates/:id', requireUser, (c) => {
    const t = store.getTemplate(c.req.param('id'));
    if (!t) throw notFound('模板');
    return c.json({ item: t });
  });

  /** 编辑器即时校验（TPL-11）：只做模板自身检查 */
  app.post('/templates/validate', requireAdmin, async (c) => {
    const body = await jsonBody(c);
    const draft = draftFrom(body, isStr(body.id) ? body.id : 'draft');
    return c.json({ report: await selfCheck(store, snapshots, draft, c.get('user')) });
  });

  /** 保存时完成自检与绑定影响检查，后保存的内容覆盖当前模板。 */
  const save = async (c: Context<ApiEnv>, isNew: boolean) => {
    const body = await jsonBody(c);
    const id = isNew ? randomId(9) : c.req.param('id')!;
    const current = isNew ? undefined : store.getTemplate(id);
    if (!isNew && !current) throw notFound('模板');
    const draft = draftFrom(body, id);
    const own = await selfCheck(store, snapshots, draft, c.get('user'));
    if (own.some((i) => i.level === 'error')) throw new HttpError(400, '模板自身校验未通过，不能保存', { report: own });

    const impact = isNew ? [] : await analyzeImpact(store, renderer, draft);
    const blocking = impact.filter((i) => i.level === 'error');
    if (blocking.some(i => store.get('profile', i.profileId)?.routing?.mode === 'bound')) throw new HttpError(409, '绑定订阅存在冲突，必须先修复成员或引用，不能强制保存', { report: own, impact });
    if (blocking.length) throw new HttpError(409, `${blocking.length} 个配置订阅存在冲突，请修复后再保存`, { report: own, impact });
    store.putTemplateVersion(draft);
    return c.json({ item: draft, report: own, impact }, isNew ? 201 : 200);
  };
  app.post('/templates', requireAdmin, c => save(c, true));
  app.put('/templates/:id', requireAdmin, c => save(c, false));
  // 兼容旧客户端入口：执行相同的直接保存，不再创建历史版本。
  app.post('/templates/:id/publish', requireAdmin, c => save(c, c.req.param('id') === 'new'));

  /** 兼容旧客户端的只读影响检查。新页面直接保存，由服务端完成检查。 */
  app.post('/templates/:id/impact', requireAdmin, async (c) => {
    const id = c.req.param('id');
    const current = store.getTemplate(id);
    if (!current) throw notFound('模板');
    const draft = draftFrom(await jsonBody(c), id);
    const report = await selfCheck(store, snapshots, draft, c.get('user'));
    return c.json({ report, impact: report.some(i => i.level === 'error') ? [] : await analyzeImpact(store, renderer, draft) });
  });

  return app;
}

/** 对所有跟随最新版本的 Profile 用新版本试渲染 */
export async function analyzeImpact(store: Store, renderer: RenderService, draft: TemplateVersionDoc): Promise<ImpactEntry[]> {
  const out: ImpactEntry[] = [];
  const profiles = store.list('profile').filter((p) => p.routing?.mode === 'bound' ? p.routing.templateId === draft.id : !p.routing && p.template?.id === draft.id && p.template.follow === 'latest');
  for (const p of profiles) {
    const res = await renderer.preview(p.id, { client: 'mihomo' }, { template: draft });
    const errors = res.report.filter((i) => i.level === 'error');
    const warns = res.report.filter((i) => i.level === 'warn' && IMPACT_CODES.has(i.code));
    if (!errors.length && !warns.length && res.ok) continue;
    const owner = store.getWithOwner('profile', p.id)?.owner ?? null;
    const issues = errors.length ? errors : warns;
    if (!res.ok && !errors.length) issues.push({ level: 'error', code: 'render.failed', message: res.failure ?? '渲染失败' });
    out.push({ profileId: p.id, profileName: p.name, owner, level: res.ok ? 'warn' : 'error', forceable: p.routing?.mode !== 'bound', issues });
  }
  return out;
}
