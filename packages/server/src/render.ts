import { CLIENT_APPS, resolveNativeBase, validateNativeText, type ClientApp } from '@sub-forge/core';
import { ruleBinding } from './rule-binding.ts';
import { queryUrl } from '@sub-forge/core';
import { SharedRuleService } from './shared-rules.ts';
import { ResourceAccessError } from './resource-access.ts';
import { profileTemplate } from './profile-routing.ts';
// 渲染服务：从存储组装内核输入 → 渲染 → 校验 → 缓存；失败时返回上一份成功结果（OUT-05 / TPL-12）。
// 渲染结果与 token 无关：地址里先写占位符，下发时再替换成请求所用的 token，
// 这样重置订阅链接后仍可复用同一 Profile 的缓存与"上一份成功结果"。

import { createHash } from 'node:crypto';
import { stringify } from 'yaml';
import {
  resolveProfileRouting, Report, renderMihomo, renderStash, renderSurge, renderLoon, isIniClient, stringifySurge, surgeProxyLine, loonProxyLine, exportStashConfig, sourceKey, sourceLabel, stableStringify,
  type Client, type HostedRuleReference, type DependencyEntry, type Matcher, type MihomoRenderResult, type NodeSetID, type NodeSetInputs, type Platform, type ReportItem, type RuleSetInputs,
} from '@sub-forge/core';
import type { ProfileDoc, RuleSetDoc, SourceDoc, TemplateVersionDoc } from './docs.ts';
import type { SnapshotService } from './snapshots.ts';
import type { Store, TrafficInfo, SnapshotRow } from './store.ts';
import { resolveRuleSetReference } from './ruleset-reference.ts';

export const TOKEN_PLACEHOLDER = '__SF_TOKEN__';
const GENERATION_PLACEHOLDER = '__SF_GENERATION__';

export type Target = { client: Client; platform?: Platform; app?: ClientApp };

function normalizeTarget(target: Target): Target {
  const app = target.app ? CLIENT_APPS.find(a => a.id === target.app) : CLIENT_APPS.find(a => a.kernel === target.client && 'platform' in a && a.platform === target.platform);
  if (target.app && (!app || app.kernel !== target.client)) throw new Error('客户端与内核不匹配');
  if (app && 'platform' in app && target.platform && app.platform !== target.platform) throw new Error('客户端与平台不匹配');
  return { client: target.client, ...(target.platform ? { platform: target.platform } : {}), ...(app ? { app: app.id, ...('platform' in app ? { platform: app.platform } : {}) } : {}) };
}

/** 可下发的渲染结果（也是"上一份成功结果"的存储格式） */
export type StoredRender = {
  /** 配置结构版本；旧数据库中的 last-good 没有这个字段。 */
  generation?: string;
  /** Loon 全部分流规则已托管；旧内联产物不可作为回退。 */
  loonRuleDelivery?: 'remote';
  yaml: string;
  providers: Record<string, string>;
  providerUserinfo?: Record<string, TrafficInfo>;
  nodeDependencies: NodeSetID[];
  ruleResources: string[];
  privateRules?: Record<string, { reference: HostedRuleReference; body: string }>;
  userinfo?: TrafficInfo;
  warnings: number;
};

export type RenderOutcome =
  | { ok: true; source: 'fresh' | 'cache' | 'last-good'; render: StoredRender; report: ReportItem[] }
  | { ok: false; message: string; report: ReportItem[]; accessDenied?: true };

export type Verifier = (yaml: string) => Promise<{ ok: boolean; output: string }>;

export type RenderServiceOptions = {
  /** 对外地址，如 https://sub.example.com（不含末尾斜杠） */
  publicUrl: string;
  /** 可选：渲染后用 mihomo -t 校验（REF-08 P1） */
  verify?: Verifier;
  cacheSize?: number;
};

/** 流量累加，缺失字段不补零，到期时间取已知的最早值。 */
function sumTraffic(infos: Iterable<TrafficInfo>): TrafficInfo | undefined {
  const sum: TrafficInfo = {};
  for (const u of infos) {
    for (const k of ['upload', 'download', 'total'] as const) if (u[k] !== undefined) sum[k] = (sum[k] ?? 0) + u[k]!;
    if (u.expire !== undefined) sum.expire = sum.expire === undefined ? u.expire : Math.min(sum.expire, u.expire);
  }
  return Object.keys(sum).length ? sum : undefined;
}

/** 同一个上游地址只计一次，重复组合成员或重复源文档不重复累计流量。 */
function nodeTraffic(ref: NodeSetID, inputs: NodeSetInputs, infos: Map<string, TrafficInfo>): TrafficInfo | undefined {
  const seen = new Set<string>(), byUrl = new Map<string, TrafficInfo>();
  const visit = (ref: NodeSetID) => {
    const key = `${ref.type}:${ref.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (ref.type === 'collection') inputs.collections[ref.id]?.members.forEach(m => visit(m.ref));
    if (ref.type === 'source') {
      const source = inputs.sources[ref.id], info = infos.get(ref.id);
      if (source && info) byUrl.set(source.url, info);
    }
  };
  visit(ref); return sumTraffic(byUrl.values());
}

class ConcurrentRenderChange extends Error {}

type Attempt = { from?: 'fresh' | 'cache'; render?: StoredRender; report: ReportItem[]; failure?: string; result?: MihomoRenderResult };

export type PreviewOutcome = { ok: boolean; format?: 'yaml' | 'ini'; yaml?: string; exportYaml?: string; exportUnavailableReason?: string; dependencies?: DependencyEntry[]; chainResolutions?: import('@sub-forge/core').ChainResolution[]; report: ReportItem[]; failure?: string };

const targetKey = (t: Target) => `${t.client}:${t.platform ?? 'any'}${t.app ? ':' + t.app : ''}`;

export class RenderService {
  readonly sharedRules: SharedRuleService;

  constructor(
    private readonly store: Store,
    private readonly snapshots: SnapshotService,
    private readonly opts: RenderServiceOptions,
  ) { this.sharedRules = new SharedRuleService(store, snapshots); }

  async render(profileId: string, target: Target): Promise<RenderOutcome> {
    target = normalizeTarget(target);
    const pre: ReportItem[] = [];
    let attempt: Attempt;
    try {
      attempt = await this.attempt(profileId, target, pre);
    } catch (e) {
      if (e instanceof ResourceAccessError) return { ok: false, accessDenied: true, message: e.message, report: pre };
      // 内核抛出的异常（如依赖解析不收敛）也按渲染失败处理，走兜底
      attempt = { report: pre, failure: `渲染异常：${(e as Error).message}` };
    }
    if (attempt.render) return { ok: true, source: attempt.from ?? 'fresh', render: attempt.render, report: attempt.report };

    if (!this.store.get('profile', profileId)) return { ok: false, message: 'Profile 不存在', report: attempt.report };
    const saved = this.store.getLastGood<StoredRender>(profileId, targetKey(target));
    const last = target.client === 'loon' && saved?.data.loonRuleDelivery !== 'remote' ? undefined : saved;
    if (last && this.store.getWithOwner('profile', profileId)?.owner && !this.canReadNodes(last.data, this.store.getWithOwner('profile', profileId)!.owner!)) return { ok: false, accessDenied: true, message: '节点资源权限已变化', report: attempt.report };
    if (last && !this.canReadRules(profileId, last.data)) return { ok: false, accessDenied: true, message: '规则资源已移除或失效', report: attempt.report };
    if (last) return { ok: true, source: 'last-good', render: last.data, report: [...attempt.report, { level: 'warn', code: 'render.last-good', message: `本次渲染失败，返回 ${new Date(last.renderedAt).toISOString()} 的成功结果：${attempt.failure}` }] };
    return { ok: false, message: attempt.failure ?? '渲染失败', report: attempt.report };
  }

  canReadNodes(render: StoredRender, owner: string): boolean {
    return Array.isArray(render.nodeDependencies) && render.nodeDependencies.every(ref => this.store.getWithOwner(ref.type, ref.id)?.owner === owner);
  }

  private ruleKey(reference: HostedRuleReference, target: Target): string {
    return reference.matcher.kind === 'ruleset'
      ? this.sharedRules.key({ ...reference, matcher: reference.matcher }, target)
      : createHash('sha256').update(stableStringify({ matcher: reference.matcher, options: reference.options, target })).digest('hex');
  }

  canReadRule(profileId: string, reference: HostedRuleReference): boolean {
    const profile = this.store.get('profile', profileId);
    if (!profile) return false;
    const template = profileTemplate(profile, (id, version) => this.store.getTemplate(id, version));
    const rules = resolveProfileRouting(profile, template, new Report()).rules;
    return rules.some(rule => rule.enabled !== false && stableStringify(rule.matcher) === stableStringify(reference.matcher) && !!rule.options?.src === !!reference.options?.src)
      && (reference.matcher.kind !== 'ruleset' || !!resolveRuleSetReference(reference.matcher, this.store));
  }

  canReadRules(profileId: string, render: StoredRender): boolean {
    return Object.values(render.privateRules ?? {}).every(rule => this.canReadRule(profileId, rule.reference))
      && render.ruleResources.every(key => {
        const record = this.store.getSharedRule<import('./shared-rules.ts').SharedRuleRecord>(key);
        return record && !record.reference.matcher.remote && !!resolveRuleSetReference(record.reference.matcher, this.store);
      });
  }

  private remember(profileId: string, target: Target, render: StoredRender): void {
    if (render.generation) this.store.putRenderGeneration(profileId, targetKey(target), render.generation, render);
    this.store.putLastGood(profileId, targetKey(target), render);
  }

  /** 只返回指定结构版本，未知版本不能回退到最新内容。 */
  getVersion(profileId: string, target: Target, version: string): StoredRender | undefined {
    target = normalizeTarget(target);
    return /^[0-9a-f]{32}$/.test(version) ? this.store.getRenderGeneration(profileId, targetKey(target), version) : undefined;
  }

  /**
   * 预演：不读写缓存、不更新"上一份成功结果"。用于 Profile 预览，以及模板发布前对现有 Profile 的试渲染（TPL-07 ②）。
   * template 传入时代替 Profile 当前引用的模板版本。
   */
  async preview(profileId: string, target: Target, overrides: { profile?: ProfileDoc; template?: TemplateVersionDoc; owner?: string } = {}): Promise<PreviewOutcome> {
    target = normalizeTarget(target);
    const pre: ReportItem[] = [];
    try {
      const a = await this.attempt(profileId, target, pre, { dry: true, ...overrides });
      return a.result
        ? { ok: !a.failure, yaml: a.result.yaml, format: isIniClient(target.client) ? 'ini' : 'yaml', ...(target.client === 'loon' && Object.keys(a.result.rulesets).length ? { exportUnavailableReason: 'Loon 规则需要通过托管链接加载。请保存配置后，通过页面顶部的订阅链接在 Loon 中获取；草稿预览不能导出为可用配置。' } : {}), ...(target.client === 'surge' && !a.failure ? { exportYaml: stringifySurge(a.result, true) } : {}), ...(target.client === 'stash' && !a.failure && !Object.values(a.result.rulesets).some(r => r.text.startsWith('#subforge-binary-mrs\n')) ? { exportYaml: exportStashConfig(a.result) } : {}), dependencies: a.result.dependencies, chainResolutions: a.result.chainResolutions, report: a.report, ...(a.failure ? { failure: a.failure } : {}) }
        : { ok: false, report: a.report, failure: a.failure ?? '渲染失败' };
    } catch (e) {
      return { ok: false, report: pre, failure: `渲染异常：${(e as Error).message}` };
    } finally { this.store.pruneResourceBindings(); }
  }

  /** 新建草稿只使用传入对象，不读取已保存的 Profile，也不读写渲染缓存、last-good 或访问日志。 */
  async previewDraft(profile: ProfileDoc, target: Target, owner?: string): Promise<PreviewOutcome> {
    return this.preview('', target, { profile: { ...profile, id: '' }, owner });
  }

  private async attempt(profileId: string, target: Target, pre: ReportItem[], opts: { dry?: boolean; profile?: ProfileDoc; template?: TemplateVersionDoc; owner?: string } = {}): Promise<Attempt> {
    for (let retry = 0; ; retry++) {
      const start = pre.length;
      try { return await this.attemptOnce(profileId, target, pre, opts); }
      catch (error) {
        if (!(error instanceof ConcurrentRenderChange) || retry >= 2) throw error;
        pre.splice(start);
      }
    }
  }

  private async attemptOnce(profileId: string, target: Target, pre: ReportItem[], opts: { dry?: boolean; profile?: ProfileDoc; template?: TemplateVersionDoc; owner?: string }): Promise<Attempt> {
    const configurationRevision = this.store.configurationRevision;
    const usedSnapshots: {snapshot:SnapshotRow;revision?:string}[] = [];
    const checkCurrent = () => {
      if (configurationRevision !== this.store.configurationRevision || usedSnapshots.some(row => !this.snapshots.isCurrent(row.snapshot,row.revision))) {
        throw new ConcurrentRenderChange('生成期间配置或资源已变化，请重试');
      }
    };
    const profile = opts.profile ?? this.store.get('profile', profileId);
    if (!profile) return { report: pre, failure: 'Profile 不存在' };

    const template = profile.routing?.mode === 'independent' ? undefined : opts.template ?? profileTemplate(profile, (id, v) => this.store.getTemplate(id, v));
    if (profile.template && !template) pre.push({ level: 'error', code: 'template.missing', message: `模板 ${profile.template.id} 不存在` });

    const owner = this.store.getWithOwner('profile', profileId)?.owner ?? opts.owner;
    const loaded = await this.loadNodeSets(profile.nodeSets.map((n) => n.ref), owner);
    usedSnapshots.push(...loaded.snapshots);
    const nodeSets = loaded.inputs;
    const userinfoBySource = loaded.userinfo;
    pre.push(...loaded.report);

    const rules = this.collectRules(profile, template);
    for (const note of template?.migrationNotes ?? []) pre.push({ level: 'warn', code: 'rules.migrated', message: note });
    for (const rs of Object.values(rules.rulesets) as RuleSetDoc[]) {
      for (const note of rs.migrationNotes ?? []) pre.push({ level: 'warn', code: 'rules.migrated', message: note });
      for (const src of rs.sources) {
        if (src.enabled === false || src.kind !== 'remote' || !src.url) continue;
        const binding = ruleBinding(rs.id, `profile:${profileId || `draft:${owner}`}`);
        const r = await this.snapshots.get('ruleset', binding.id, src.url, { ...src.fetch, format: src.format, behavior: src.behavior, scope: binding.scope });
        checkCurrent();
        if (r.snapshot) usedSnapshots.push({snapshot:r.snapshot,revision:r.revision});
        if (r.snapshot?.body !== undefined) {
          rules.snapshots[sourceKey(rs.id, src.id)] = r.snapshot.body;
        }
        if (r.error) pre.push({ level: r.snapshot ? 'warn' : 'error', code: 'ruleset.fetch-failed', message: `规则集「${rs.name}」的来源「${sourceLabel(src)}」拉取失败${r.snapshot ? '，正在使用快照' : ''}：${r.error}`, where: `ruleset:${rs.id}` });
      }
    }

    checkCurrent();
    const preset = profile.base?.enabled !== false && profile.base?.presetId ? this.store.get('preset', profile.base.presetId) : undefined;
    if (profile.base?.enabled !== false && profile.base?.presetId && !preset) pre.push({ level: 'error', code: 'preset.missing', message: `基础设置预设 ${profile.base.presetId} 不存在` });
    for (const text of [preset?.config.kernels?.[target.client], target.app ? preset?.config.clients?.[target.app] : undefined]) if (text !== undefined) validateNativeText(text, target.client, 'preset');
    for (const note of [...(preset?.migrationNotes ?? []), ...(profile.migrationNotes ?? [])]) pre.push({ level: 'warn', code: 'base.migrated', message: note });
    const base = profile.base && profile.base.enabled !== false ? resolveNativeBase(target.client, target.app, preset?.config, profile.base) : undefined;
    const userinfo = this.userinfo(profile, userinfoBySource);

    const publicUrl = this.opts.publicUrl.replace(/\/$/, '');
    const output = { target: target.client, platform: target.platform, app: target.app, token: TOKEN_PLACEHOLDER };
    const ruleReferences = new Map<string, HostedRuleReference>();
    const result = (target.client === 'loon' ? renderLoon : target.client === 'surge' ? renderSurge : target.client === 'stash' ? renderStash : renderMihomo)({
      profile, nodeSets, rules, resourceIntervalSec:this.store.resourceCacheTtlSec,
      ...(template ? { template } : {}),
      ...(target.platform ? { platform: target.platform } : {}),
      ...(base ? { base } : {}),
      urls: {
        provider: (k, v) => queryUrl('/subs/nodes', { kind: 'provider', profile: profile.id, id: k, version: GENERATION_PLACEHOLDER, hash: v, ...output }, publicUrl),
        ruleset: (k, reference) => {
          if (!reference) throw new Error('托管规则缺少资源定义');
          ruleReferences.set(k, reference);
          const key = this.ruleKey(reference, target);
          return reference.matcher.kind !== 'ruleset' || reference.matcher.remote
            ? queryUrl('/subs/ruleset', { profile: profile.id, key, version: GENERATION_PLACEHOLDER, ...output }, publicUrl)
            : queryUrl(reference.matcher.repository ? '/resources/repo' : '/resources/ruleset', { key, token: TOKEN_PLACEHOLDER }, publicUrl);
        },
      },
    });
    const report = [...pre, ...result.report.items];
    const errors = report.filter((i) => i.level === 'error');
    if (errors.length) return { report, result, failure: errors.map((e) => e.message).join('；') };

    // 文档意图与主配置结构决定版本。远程快照不参与；兼容的节点/规则内容可在本版本独立更新。
    // provider 的 hash 仅用于主配置刷新时破除客户端缓存，不影响结构版本。
    const loonRuleDelivery = target.client === 'loon' ? 'remote' as const : undefined;
    const contract = structuredClone(result.config);
    for (const entry of Object.values((contract['proxy-providers'] ?? {}) as Record<string, { url: string }>)) {
      entry.url = entry.url.replace(/&hash=[0-9a-f]+/, '');
    }
    const generation = createHash('sha256').update(stableStringify({
      profile, template, base, target, contract, loonRuleDelivery,
      sources: nodeSets.sources, collections: nodeSets.collections, locals: nodeSets.locals,
      rulesets: rules.rulesets,
    })).digest('hex').slice(0, 32);
    result.yaml = result.yaml.replaceAll(GENERATION_PLACEHOLDER, generation);

    if (this.opts.verify && target.client === 'mihomo') {
      const v = await this.opts.verify(result.yaml.replaceAll(TOKEN_PLACEHOLDER, 'verify'));
      checkCurrent();
      if (!v.ok) {
        report.push({ level: 'error', code: 'verify.mihomo', message: `mihomo -t 校验失败：${v.output.trim().split('\n').slice(-3).join(' ')}` });
        return { report, result, failure: 'mihomo -t 校验失败' };
      }
    }

    checkCurrent();
    const render: StoredRender = {
      generation,
      ...(loonRuleDelivery ? { loonRuleDelivery } : {}),
      yaml: target.client === 'surge'
        ? '#!MANAGED-CONFIG ' + queryUrl('/subs/profile', { id: profile.id, ...output }, publicUrl) + ' interval=' + this.store.resourceCacheTtlSec + ' strict=false\n' + result.yaml
        : result.yaml,
      nodeDependencies: [
        ...Object.keys(nodeSets.sources).map(id => ({ type: 'source' as const, id })),
        ...Object.keys(nodeSets.collections).map(id => ({ type: 'collection' as const, id })),
        ...Object.keys(nodeSets.locals).map(id => ({ type: 'local' as const, id })),
      ],
      providers: Object.fromEntries(Object.entries(result.providers).map(([k, p]) => [k, p.yaml])),
      providerUserinfo: Object.fromEntries(profile.nodeSets.flatMap(({ ref }) => {
        const info = nodeTraffic(ref, nodeSets, userinfoBySource);
        return info ? [[`${ref.type}:${ref.id}`, info]] : [];
      })),
      ruleResources: [...new Set([...ruleReferences.values()].filter(ref => ref.matcher.kind === 'ruleset' && !ref.matcher.remote).map(ref => this.ruleKey(ref, target)))],
      privateRules: Object.fromEntries([...ruleReferences].filter(([, ref]) => ref.matcher.kind !== 'ruleset' || ref.matcher.remote).map(([file, reference]) => [this.ruleKey(reference, target), { reference, body: result.rulesets[file]!.text }])),
      warnings: report.filter((i) => i.level === 'warn').length,
      ...(userinfo ? { userinfo } : {}),
    };
    if (opts.dry) return { from: 'fresh', render, report, result };

    this.store.db.transaction(() => {
      for (const [file, reference] of ruleReferences) {
        const body = result.rulesets[file]?.text;
        if (body !== undefined && reference.matcher.kind === 'ruleset' && !reference.matcher.remote) this.sharedRules.register({ ...reference, matcher: reference.matcher }, target, rules.rulesets[reference.matcher.id] as RuleSetDoc, rules, body);
      }
      this.remember(profileId, target, render);
    })();
    return { from: 'fresh', render, report };
  }

  /**
   * 收集节点集（含组合成员，递归）并取得远程订阅源的快照。处理链逐步预览也用它。
   * 返回的 hashes 用作缓存键的一部分（用快照哈希而不是正文）。
   */
  async loadNodeSets(refs: NodeSetID[], owner?: string | null): Promise<{ inputs: NodeSetInputs; userinfo: Map<string, TrafficInfo>; hashes: string[]; report: ReportItem[]; snapshots: {snapshot:SnapshotRow;revision?:string}[] }> {
    const configurationRevision = this.store.configurationRevision;
    const { inputs, sources } = this.collectNodeSets(refs, owner);
    const userinfo = new Map<string, TrafficInfo>();
    const hashes: string[] = [];
    const snapshots: {snapshot:SnapshotRow;revision?:string}[] = [];
    const report: ReportItem[] = [];
    for (const src of sources) {
      const r = await this.snapshots.get('source', src.id, src.url, {});
      if (configurationRevision !== this.store.configurationRevision) throw new ConcurrentRenderChange('节点依赖在拉取期间变化，请重试');
      if (r.snapshot) snapshots.push({snapshot:r.snapshot,revision:r.revision});
      if (r.snapshot?.body !== undefined) {
        inputs.snapshots[src.id] = [r.snapshot.body];
        hashes.push(`${src.id}|${src.url}|${r.snapshot.hash}`);
        if (r.snapshot.userinfo) userinfo.set(src.id, r.snapshot.userinfo);
      }
      if (r.error) report.push({ level: r.snapshot ? 'warn' : 'error', code: 'source.fetch-failed', message: `订阅源「${src.name}」拉取失败${r.snapshot ? '，正在使用快照' : ''}：${r.error}`, where: `source:${src.id}` });
    }
    return { inputs, userinfo, hashes, report, snapshots };
  }

  async nodeSet(ref: NodeSetID, owner: string, target: Target = { client: 'mihomo' }): Promise<{ yaml: string; userinfo?: TrafficInfo }> {
    if (this.store.getWithOwner(ref.type, ref.id)?.owner !== owner) throw new ResourceAccessError();
    const revision = this.store.configurationRevision;
    const loaded = await this.loadNodeSets([ref], owner);
    if (revision !== this.store.configurationRevision) throw new ResourceAccessError();
    if (this.store.getWithOwner(ref.type, ref.id)?.owner !== owner) throw new ResourceAccessError();
    const result = (target.client === 'loon' ? renderLoon : target.client === 'surge' ? renderSurge : target.client === 'stash' ? renderStash : renderMihomo)({
      profile: { id: '$nodes', name: '', nodeSets: [{ ref, output: 'inline' }], chains: [], refPolicy: { default: 'wrap' }, overlay: {}, routing: { mode: 'independent', config: { groups: [], rules: [], final: { kind: 'builtin', name: 'DIRECT' } } } },
      platform: target.platform,
      nodeSets: loaded.inputs, rules: { rulesets: {}, snapshots: {} }, urls: { provider: key => key, ruleset: key => key },
    });
    const yaml = isIniClient(target.client) ? (result.config.proxies as Record<string, unknown>[]).flatMap(node => {
      const line = (target.client === 'loon' ? loonProxyLine : surgeProxyLine)(node, result.report);
      return line ? [line] : [];
    }).join('\n') + '\n' : stringify({ proxies: result.config.proxies ?? [] }, { lineWidth: 0 });
    const errors = [...loaded.report, ...result.report.items].filter(i => i.level === 'error');
    if (errors.length) throw new Error(errors.map(i => i.message).join('；'));
    return { yaml, userinfo: nodeTraffic(ref, loaded.inputs, loaded.userinfo) };
  }

  collectNodeSets(refs: NodeSetID[], owner?: string | null): { inputs: NodeSetInputs; sources: SourceDoc[] } {
    const inputs: NodeSetInputs = { sources: {}, collections: {}, locals: {}, snapshots: {} };
    const seen = new Set<string>();
    const walk = (ref: NodeSetID, expectedOwner?: string | null) => {
      const row = this.store.getWithOwner(ref.type, ref.id);
      if (row && expectedOwner && row.owner !== expectedOwner) throw new ResourceAccessError();
      const k = `${ref.type}:${ref.id}`;
      if (seen.has(k)) return;
      seen.add(k);
      if (ref.type === 'source') { const d = this.store.get('source', ref.id); if (d) inputs.sources[d.id] = d; }
      else if (ref.type === 'local') { const d = this.store.get('local', ref.id); if (d) inputs.locals[d.id] = d; }
      else { const d = this.store.get('collection', ref.id); if (d) { inputs.collections[d.id] = d; d.members.forEach((m) => walk(m.ref, expectedOwner)); } }
    };
    refs.forEach(ref => walk(ref, owner ?? this.store.getWithOwner(ref.type, ref.id)?.owner));
    return { inputs, sources: Object.values(inputs.sources) as SourceDoc[] };
  }

  /** 模板规则与 Profile 私有规则引用到的规则集 */
  collectRules(profile: ProfileDoc, template: TemplateVersionDoc | undefined): RuleSetInputs {
    const out: RuleSetInputs = { rulesets: {}, snapshots: {} };
    const visit = (m: Matcher) => {
      if (m.kind !== 'ruleset') return;
      const d = resolveRuleSetReference(m, this.store);
      if (d) out.rulesets[m.id] = d;
    };
    // 与内核渲染使用同一份有效规则：覆盖层可禁用或重新启用模板规则，孤儿锚点也不再参与拉取。
    // 合并报告由 renderMihomo 统一返回，避免重复记录。
    for (const r of resolveProfileRouting(profile, template, new Report()).rules) {
      if (r.enabled !== false) visit(r.matcher);
    }
    return out;
  }

  private userinfo(profile: ProfileDoc, bySource: Map<string, TrafficInfo>): TrafficInfo | undefined {
    const mode = profile.userinfo ?? { mode: 'sum' };
    if (mode.mode === 'none') return undefined;
    if (mode.mode === 'source') return bySource.get(mode.sourceId);
    return sumTraffic(bySource.values());
  }
}
