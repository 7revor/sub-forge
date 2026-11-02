import { CLIENT_APPS, resolveNativeBase, type ClientApp } from '@sub-forge/core';
import { ruleBinding } from './rule-binding.ts';
import { managedRuleDelivery, queryUrl, type RuleResourceReference } from '@sub-forge/core';
import { SharedRuleService } from './shared-rules.ts';
import { ResourceAccessError } from './resource-access.ts';
import { profileTemplate } from './profile-routing.ts';
// 渲染服务：从存储组装内核输入 → 渲染 → 校验；结果不落库，失败直接返回错误，由客户端保留本地配置。
// 渲染结果与 token 无关：地址里先写占位符，下发时再替换成请求所用的 token。

import { createHash } from 'node:crypto';
import { stringify } from 'yaml';
import {
  resolveProfileRouting, Report, renderClash, renderSurge, renderLoon, isIniClient, stringifySurge, surgeProxyLine, loonProxyLine, exportStashConfig, sourceKey, sourceLabel, stableStringify,
  type Client, type HostedRuleReference, type DependencyEntry, type Matcher, type MihomoRenderResult, type NodeSetID, type NodeSetInputs, type Platform, type ReportItem, type RuleSetInputs, type RuleEntry,
} from '@sub-forge/core';
import type { ProfileDoc, RuleSetDoc, SourceDoc, TemplateVersionDoc } from './docs.ts';
import type { SnapshotService } from './snapshots.ts';
import type { Store, TrafficInfo, SnapshotRow } from './store.ts';
import { resolveRuleSetReference } from './ruleset-reference.ts';

export const TOKEN_PLACEHOLDER = '__SF_TOKEN__';

export type Target = { client: Client; platform?: Platform; app?: ClientApp };

function normalizeTarget(target: Target): Target {
  const app = target.app ? CLIENT_APPS.find(a => a.id === target.app) : CLIENT_APPS.find(a => a.kernel === target.client && 'platform' in a && a.platform === target.platform);
  if (target.app && (!app || app.kernel !== target.client)) throw new Error('客户端与内核不匹配');
  if (app && 'platform' in app && target.platform && app.platform !== target.platform) throw new Error('客户端与平台不匹配');
  return { client: target.client, ...(target.platform ? { platform: target.platform } : {}), ...(app ? { app: app.id, ...('platform' in app ? { platform: app.platform } : {}) } : {}) };
}

/** Stash 和 Mihomo 均进入公共 YAML 生成流程。 */
function renderForClient(input: Parameters<typeof renderClash>[0], client: Client): MihomoRenderResult {
  return client === 'surge' ? renderSurge(input) : client === 'loon' ? renderLoon(input) : renderClash(input, client);
}

/** 可下发的渲染结果 */
export type StoredRender = {
  providerNodeCounts?: Record<string, number>;
  yaml: string;
  providers: Record<string, string>;
  providerUserinfo?: Record<string, TrafficInfo>;
  nodeDependencies: NodeSetID[];
  /** 按 ruleKey 请求时才有：订阅专属规则正文。 */
  ruleBody?: string;
  userinfo?: TrafficInfo;
  warnings: number;
};

export type RenderOutcome =
  | { ok: true; render: StoredRender; report: ReportItem[] }
  | { ok: false; message: string; report: ReportItem[]; accessDenied?: true };

export type Verifier = (yaml: string) => Promise<{ ok: boolean; output: string }>;

export type RenderServiceOptions = {
  /** 对外地址，如 https://sub.example.com（不含末尾斜杠） */
  publicUrl: string;
  /** 可选：渲染后用 mihomo -t 校验（REF-08 P1） */
  verify?: Verifier;
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

type Attempt = { render?: StoredRender; report: ReportItem[]; failure?: string; result?: MihomoRenderResult };

export type PreviewOutcome = { ok: boolean; format?: 'yaml' | 'ini'; yaml?: string; exportYaml?: string; exportUnavailableReason?: string; dependencies?: DependencyEntry[]; chainResolutions?: import('@sub-forge/core').ChainResolution[]; report: ReportItem[]; failure?: string };

export class RenderService {
  readonly sharedRules: SharedRuleService;

  constructor(
    private readonly store: Store,
    private readonly snapshots: SnapshotService,
    private readonly opts: RenderServiceOptions,
  ) { this.sharedRules = new SharedRuleService(store, snapshots); }

  /** 更新声明只属于已保存的主订阅；草稿和独立导出不绑定更新地址。 */
  private managedProfileYaml(yaml: string, profileId: string, target: Target): string {
    if (!profileId || (target.client !== 'surge' && target.client !== 'stash')) return yaml;
    const url = queryUrl('/subs/profile', { id: profileId, target: target.client, platform: target.platform, app: target.app, token: TOKEN_PLACEHOLDER }, this.opts.publicUrl.replace(/\/$/, ''));
    const header = target.client === 'surge'
      ? `#!MANAGED-CONFIG ${url} interval=${this.store.resourceCacheTtlSec} strict=false`
      : `#SUBSCRIBED ${url}`;
    // 回退结果可能已有声明，旧结果也要补齐并使用当前更新间隔。
    return header + '\n' + yaml.replace(/^(?:#!MANAGED-CONFIG|#SUBSCRIBED)\b[^\r\n]*(?:\r?\n|$)/, '');
  }

  async render(profileId: string, target: Target, ruleKey?: string): Promise<RenderOutcome> {
    target = normalizeTarget(target);
    const pre: ReportItem[] = [];
    let attempt: Attempt;
    try {
      attempt = await this.attempt(profileId, target, pre, ruleKey ? { ruleKey } : {});
    } catch (e) {
      if (e instanceof ResourceAccessError) return { ok: false, accessDenied: true, message: e.message, report: pre };
      // 内核抛出的异常（如依赖解析不收敛）也按渲染失败处理，走兜底
      attempt = { report: pre, failure: `渲染异常：${(e as Error).message}` };
    }
    if (attempt.render) return { ok: true, render: attempt.render, report: attempt.report };
    return { ok: false, message: attempt.failure ?? '渲染失败', report: attempt.report };
  }

  canReadNodes(render: StoredRender, owner: string): boolean {
    return Array.isArray(render.nodeDependencies) && render.nodeDependencies.every(ref => this.store.getWithOwner(ref.type, ref.id)?.owner === owner);
  }

  /** 订阅专属规则的地址标识：只用于在当前配置中定位规则，不存储。 */
  private ruleKey(reference: HostedRuleReference, target: Target): string {
    return createHash('sha256').update(stableStringify({ matcher: reference.matcher, options: reference.options, target })).digest('hex');
  }

  /** 公共规则地址写明身份、内核和格式契约，服务端无需保存任何映射即可按需转换。 */
  private publicRuleUrl(reference: RuleResourceReference, rs: RuleSetDoc, target: Target): string {
    const delivery = managedRuleDelivery(rs, target, reference.options);
    const contract = delivery.mode === 'managed' ? { format: delivery.format, ...(delivery.format === 'mrs' ? { behavior: delivery.behavior } : {}) } : {};
    const common = { target: target.client, ...contract, ...(reference.options?.src ? { src: '1' } : {}), token: TOKEN_PLACEHOLDER };
    const repository = reference.matcher.repository;
    if (!repository) return queryUrl('/resources/ruleset', { id: reference.matcher.id, ...common }, this.opts.publicUrl.replace(/\/$/, ''));
    const files = repository.sources.filter(source => source.enabled !== false).map(source => ({ ref: source.repository!.ref, path: source.repository!.path }));
    return queryUrl('/resources/repo', { id: repository.repo, files: JSON.stringify(files), ...common }, this.opts.publicUrl.replace(/\/$/, ''));
  }

  /**
   * 预演：复用上游快照，不读写"上一份成功结果"。用于 Profile 预览，以及模板发布前对现有 Profile 的试渲染（TPL-07 ②）。
   * template 传入时代替 Profile 当前引用的模板版本。
   */
  async preview(profileId: string, target: Target, overrides: { profile?: ProfileDoc; template?: TemplateVersionDoc; owner?: string } = {}): Promise<PreviewOutcome> {
    target = normalizeTarget(target);
    const pre: ReportItem[] = [];
    try {
      const a = await this.attempt(profileId, target, pre, { dry: true, ...overrides });
      if (!a.result) return { ok: false, report: a.report, failure: a.failure ?? '渲染失败' };
      const hasProviders = Object.keys(a.result.providers).length > 0;
      const exportUnavailableReason = hasProviders
        ? '配置包含远程节点引用。请保存配置后使用页面顶部的订阅链接获取，草稿地址不能用于客户端下载。'
        : target.client === 'loon' && Object.keys(a.result.rulesets).length
          ? 'Loon 规则需要通过托管链接加载。请保存配置后，通过页面顶部的订阅链接在 Loon 中获取；草稿预览不能导出为可用配置。' : undefined;
      return { ok: !a.failure, yaml: this.managedProfileYaml(a.result.yaml, profileId, target), format: isIniClient(target.client) ? 'ini' : 'yaml',
        ...(exportUnavailableReason ? { exportUnavailableReason } : {}),
        ...(target.client === 'surge' && !a.failure && !hasProviders ? { exportYaml: stringifySurge(a.result, true) } : {}),
        ...(target.client === 'stash' && !a.failure && !hasProviders && !Object.values(a.result.rulesets).some(r => r.text.startsWith('#subforge-binary-mrs\n')) ? { exportYaml: exportStashConfig(a.result) } : {}),
        dependencies: a.result.dependencies, chainResolutions: a.result.chainResolutions, report: a.report, ...(a.failure ? { failure: a.failure } : {}),
      };
    } catch (e) {
      return { ok: false, report: pre, failure: `渲染异常：${(e as Error).message}` };
    } finally { this.store.pruneResourceBindings(); }
  }

  /** 新建草稿只使用传入对象，不读取已保存的 Profile，也不写访问日志。 */
  async previewDraft(profile: ProfileDoc, target: Target, owner?: string): Promise<PreviewOutcome> {
    return this.preview('', target, { profile: { ...profile, id: '' }, owner });
  }

  private async attempt(profileId: string, target: Target, pre: ReportItem[], opts: { dry?: boolean; ruleKey?: string; profile?: ProfileDoc; template?: TemplateVersionDoc; owner?: string } = {}): Promise<Attempt> {
    for (let retry = 0; ; retry++) {
      const start = pre.length;
      try { return await this.attemptOnce(profileId, target, pre, opts); }
      catch (error) {
        if (!(error instanceof ConcurrentRenderChange) || retry >= 2) throw error;
        pre.splice(start);
      }
    }
  }

  private async attemptOnce(profileId: string, target: Target, pre: ReportItem[], opts: { dry?: boolean; ruleKey?: string; profile?: ProfileDoc; template?: TemplateVersionDoc; owner?: string }): Promise<Attempt> {
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
    if ('template' in profile && profile.template && !template) pre.push({ level: 'error', code: 'template.missing', message: `模板 ${profile.template.id} 不存在` });

    const owner = this.store.getWithOwner('profile', profileId)?.owner ?? opts.owner;
    const trafficRefs: NodeSetID[] = profile.userinfo?.mode === 'sources'
      ? profile.userinfo.sourceIds.map(id => ({ type: 'source', id })) : [];
    for (const ref of trafficRefs) {
      const row = this.store.getWithOwner('source', ref.id);
      if (!row || (owner && row.owner !== owner)) throw new ResourceAccessError();
    }
    const loaded = await this.loadNodeSets([...profile.nodeSets.map(n => n.ref), ...trafficRefs], owner);
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
    for (const note of profile.migrationNotes ?? []) pre.push({ level: 'warn', code: 'base.migrated', message: note });
    const base = profile.base && profile.base.enabled !== false ? resolveNativeBase(target.client, target.app, profile.base) : undefined;
    const userinfo = this.userinfo(profile, userinfoBySource, nodeSets);

    const publicUrl = this.opts.publicUrl.replace(/\/$/, '');
    const output = { target: target.client, platform: target.platform, app: target.app, token: TOKEN_PLACEHOLDER };
    const ruleReferences = new Map<string, HostedRuleReference>();
    const result = renderForClient({
      profile, nodeSets, rules, resourceIntervalSec:this.store.resourceCacheTtlSec,
      ...(template ? { template } : {}),
      ...(target.platform ? { platform: target.platform } : {}),
      ...(base ? { base } : {}),
      // 预览需要完整诊断和可导出的正文；主配置只写地址，正文由规则文件请求生成。
      ...(opts.dry ? {} : { deferRuleBody: reference => this.ruleKey(reference, target) !== opts.ruleKey }),
      urls: {
        provider: k => queryUrl('/subs/nodes', { kind: 'provider', profile: profile.id, id: k, ...output }, publicUrl),
        ruleset: (k, reference) => {
          if (!reference) throw new Error('托管规则缺少资源定义');
          ruleReferences.set(k, reference);
          if (reference.matcher.kind === 'ruleset' && !reference.matcher.remote) return this.publicRuleUrl({ ...reference, matcher: reference.matcher }, rules.rulesets[reference.matcher.id] as RuleSetDoc, target);
          return queryUrl('/subs/ruleset', { profile: profile.id, key: this.ruleKey(reference, target), ...output }, publicUrl);
        },
      },
    }, target.client);
    const report = [...pre, ...result.report.items];
    const errors = report.filter((i) => i.level === 'error');
    if (errors.length) return { report, result, failure: errors.map((e) => e.message).join('；') };

    if (this.opts.verify && target.client === 'mihomo') {
      const v = await this.opts.verify(result.yaml.replaceAll(TOKEN_PLACEHOLDER, 'verify'));
      checkCurrent();
      if (!v.ok) {
        report.push({ level: 'error', code: 'verify.mihomo', message: `mihomo -t 校验失败：${v.output.trim().split('\n').slice(-3).join(' ')}` });
        return { report, result, failure: 'mihomo -t 校验失败' };
      }
    }

    checkCurrent();
    const requestedRule = opts.ruleKey ? [...ruleReferences].find(([, reference]) => (reference.matcher.kind !== 'ruleset' || reference.matcher.remote) && this.ruleKey(reference, target) === opts.ruleKey) : undefined;
    const render: StoredRender = {
      providerNodeCounts: Object.fromEntries(Object.entries(result.providers).flatMap(([key, provider]) => provider.nodeCount === undefined ? [] : [[key, provider.nodeCount]])),
      yaml: this.managedProfileYaml(result.yaml, profile.id, target),
      nodeDependencies: [
        ...Object.keys(nodeSets.sources).map(id => ({ type: 'source' as const, id })),
        ...Object.keys(nodeSets.collections).map(id => ({ type: 'collection' as const, id })),
        ...Object.keys(nodeSets.locals).map(id => ({ type: 'local' as const, id })),
      ],
      providers: Object.fromEntries(Object.entries(result.providers).map(([k, p]) => [k, p.yaml])),
      providerUserinfo: Object.fromEntries(Object.entries(result.providers).flatMap(([key, provider]) => {
        const sourceKeys = new Set(provider.sourceKeys ?? [key]);
        const refs = profile.nodeSets.filter(({ ref }) => sourceKeys.has(`${ref.type}:${ref.id}`));
        const infos = new Map<string, TrafficInfo>();
        const seen = new Set<string>();
        const visit = (ref: NodeSetID) => {
          const key = `${ref.type}:${ref.id}`;
          if (seen.has(key)) return;
          seen.add(key);
          if (ref.type === 'collection') nodeSets.collections[ref.id]?.members.forEach(m => visit(m.ref));
          if (ref.type === 'source') { const source = nodeSets.sources[ref.id], info = userinfoBySource.get(ref.id); if (source && info) infos.set(source.url, info); }
        };
        refs.forEach(({ ref }) => visit(ref));
        const info = sumTraffic(infos.values());
        return info ? [[key, info]] : [];
      })),
      ...(requestedRule ? { ruleBody: result.rulesets[requestedRule[0]]?.text } : {}),
      warnings: report.filter((i) => i.level === 'warn').length,
      ...(userinfo ? { userinfo } : {}),
    };
    if (opts.dry) return { render, report, result };
    return { render, report };
  }

  /**
   * 收集节点集（含组合成员，递归）并取得远程订阅源的快照。处理链逐步预览也用它。
   */
  async loadNodeSets(refs: NodeSetID[], owner?: string | null): Promise<{ inputs: NodeSetInputs; userinfo: Map<string, TrafficInfo>; report: ReportItem[]; snapshots: {snapshot:SnapshotRow;revision?:string}[] }> {
    const configurationRevision = this.store.configurationRevision;
    const { inputs, sources } = this.collectNodeSets(refs, owner);
    const userinfo = new Map<string, TrafficInfo>();
    const snapshots: {snapshot:SnapshotRow;revision?:string}[] = [];
    const report: ReportItem[] = [];
    for (const src of sources) {
      const r = await this.snapshots.get('source', src.id, src.url, {});
      if (configurationRevision !== this.store.configurationRevision) throw new ConcurrentRenderChange('节点依赖在拉取期间变化，请重试');
      if (r.snapshot) snapshots.push({snapshot:r.snapshot,revision:r.revision});
      if (r.snapshot?.body !== undefined) {
        inputs.snapshots[src.id] = [r.snapshot.body];
        if (r.snapshot.userinfo) userinfo.set(src.id, r.snapshot.userinfo);
      }
      if (r.error) report.push({ level: r.snapshot ? 'warn' : 'error', code: 'source.fetch-failed', message: `订阅源「${src.name}」拉取失败${r.snapshot ? '，正在使用快照' : ''}：${r.error}`, where: `source:${src.id}` });
    }
    return { inputs, userinfo, report, snapshots };
  }

  async nodeSet(ref: NodeSetID, owner: string, target: Target = { client: 'mihomo' }): Promise<{ yaml: string; userinfo?: TrafficInfo }> {
    if (this.store.getWithOwner(ref.type, ref.id)?.owner !== owner) throw new ResourceAccessError();
    const revision = this.store.configurationRevision;
    const loaded = await this.loadNodeSets([ref], owner);
    if (revision !== this.store.configurationRevision) throw new ResourceAccessError();
    if (this.store.getWithOwner(ref.type, ref.id)?.owner !== owner) throw new ResourceAccessError();
    const result = renderForClient({
      profile: { id: '$nodes', name: '', nodeSets: [{ ref, output: 'inline' }], chains: [], routing: { mode: 'independent', config: { groups: [], rules: [], final: { kind: 'builtin', name: 'DIRECT' } } } },
      platform: target.platform,
      nodeSets: loaded.inputs, rules: { rulesets: {}, snapshots: {} }, urls: { provider: key => key, ruleset: key => key },
    }, target.client);
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
    // 合并报告由渲染统一返回；历史输入仍由同一解析器兼容。
    return this.collectRuleEntries(resolveProfileRouting(profile, template, new Report()).rules);
  }

  /** 已有有效规则直接收集依赖，模板无需构造临时订阅。 */
  collectRuleEntries(rules: RuleEntry[]): RuleSetInputs {
    const out: RuleSetInputs = { rulesets: {}, snapshots: {} };
    const visit = (m: Matcher) => {
      if (m.kind !== 'ruleset') return;
      const d = resolveRuleSetReference(m, this.store);
      if (d) out.rulesets[m.id] = d;
    };
    for (const r of rules) {
      if (r.enabled !== false) visit(r.matcher);
    }
    return out;
  }

  private userinfo(profile: ProfileDoc, bySource: Map<string, TrafficInfo>, inputs: NodeSetInputs): TrafficInfo | undefined {
    const mode = profile.userinfo ?? { mode: 'sum' };
    if (mode.mode === 'none') return undefined;
    if (mode.mode === 'source') return bySource.get(mode.sourceId);
    const ids = mode.mode === 'sources' ? mode.sourceIds : [...bySource.keys()];
    const byUrl = new Map<string, TrafficInfo>();
    for (const id of ids) {
      const info = bySource.get(id), source = inputs.sources[id];
      if (info && source) byUrl.set(source.url, info);
    }
    return sumTraffic(byUrl.values());
  }
}
