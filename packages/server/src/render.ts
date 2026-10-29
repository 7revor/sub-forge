import { profileTemplate } from './profile-routing.ts';
// 渲染服务：从存储组装内核输入 → 渲染 → 校验 → 缓存；失败时返回上一份成功结果（OUT-05 / TPL-12）。
// 渲染结果与 token 无关：地址里先写占位符，下发时再替换成请求所用的 token，
// 这样同一 Profile 的多个订阅链接共用缓存与"上一份成功结果"。

import { createHash } from 'node:crypto';
import {
  resolveProfileRouting, Report, renderMihomo, sourceKey, sourceLabel, stableHash, stableStringify,
  type DependencyEntry, type Matcher, type MihomoRenderResult, type NodeSetID, type NodeSetInputs, type Platform, type ReportItem, type RuleSetInputs,
} from '@sub-forge/core';
import type { ProfileDoc, RuleSetDoc, SourceDoc, TemplateVersionDoc } from './docs.ts';
import type { SnapshotService } from './snapshots.ts';
import type { Store, TrafficInfo } from './store.ts';
import { resolveRuleSetReference } from './ruleset-reference.ts';

export const TOKEN_PLACEHOLDER = '__SF_TOKEN__';
const GENERATION_PLACEHOLDER = '__SF_GENERATION__';

export type Target = { client: 'mihomo'; platform?: Platform };

/** 可下发的渲染结果（也是"上一份成功结果"的存储格式） */
export type StoredRender = {
  /** 配置结构版本；旧数据库中的 last-good 没有这个字段。 */
  generation?: string;
  yaml: string;
  providers: Record<string, string>;
  rulesets: Record<string, string>;
  userinfo?: TrafficInfo;
  warnings: number;
};

export type RenderOutcome =
  | { ok: true; source: 'fresh' | 'cache' | 'last-good'; render: StoredRender; report: ReportItem[] }
  | { ok: false; message: string; report: ReportItem[] };

export type Verifier = (yaml: string) => Promise<{ ok: boolean; output: string }>;

export type RenderServiceOptions = {
  /** 对外地址，如 https://sub.example.com（不含末尾斜杠） */
  publicUrl: string;
  /** 可选：渲染后用 mihomo -t 校验（REF-08 P1） */
  verify?: Verifier;
  cacheSize?: number;
};

const SOURCE_TTL_SEC = 86400;
const RULESET_TTL_SEC = 86400;

/** 流量累加，缺失字段不补零，到期时间取已知的最早值。 */
function sumTraffic(infos: Iterable<TrafficInfo>): TrafficInfo | undefined {
  const sum: TrafficInfo = {};
  for (const u of infos) {
    for (const k of ['upload', 'download', 'total'] as const) if (u[k] !== undefined) sum[k] = (sum[k] ?? 0) + u[k]!;
    if (u.expire !== undefined) sum.expire = sum.expire === undefined ? u.expire : Math.min(sum.expire, u.expire);
  }
  return Object.keys(sum).length ? sum : undefined;
}

function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const b = out[k];
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && b && typeof b === 'object' && !Array.isArray(b)
      ? deepMerge(b as Record<string, unknown>, v as Record<string, unknown>)
      : v;
  }
  return out;
}

type Attempt = { from?: 'fresh' | 'cache'; render?: StoredRender; report: ReportItem[]; failure?: string; result?: MihomoRenderResult };

export type PreviewOutcome = { ok: boolean; yaml?: string; dependencies?: DependencyEntry[]; report: ReportItem[]; failure?: string };

const targetKey = (t: Target) => `${t.client}:${t.platform ?? 'any'}`;

export class RenderService {
  private readonly cache = new Map<string, { render: StoredRender; report: ReportItem[] }>();

  constructor(
    private readonly store: Store,
    private readonly snapshots: SnapshotService,
    private readonly opts: RenderServiceOptions,
  ) {}

  async render(profileId: string, target: Target): Promise<RenderOutcome> {
    const pre: ReportItem[] = [];
    let attempt: Attempt;
    try {
      this.preserveLegacy(profileId, target);
      attempt = await this.attempt(profileId, target, pre);
    } catch (e) {
      // 内核抛出的异常（如依赖解析不收敛）也按渲染失败处理，走兜底
      attempt = { report: pre, failure: `渲染异常：${(e as Error).message}` };
    }
    if (attempt.render) return { ok: true, source: attempt.from ?? 'fresh', render: attempt.render, report: attempt.report };

    const last = this.store.getLastGood<StoredRender>(profileId, targetKey(target));
    if (last) return { ok: true, source: 'last-good', render: last.data, report: [...attempt.report, { level: 'warn', code: 'render.last-good', message: `本次渲染失败，返回 ${new Date(last.renderedAt).toISOString()} 的成功结果：${attempt.failure}` }] };
    return { ok: false, message: attempt.failure ?? '渲染失败', report: attempt.report };
  }

  /** 只返回指定结构版本，未知版本不能回退到最新内容。 */
  getVersion(profileId: string, target: Target, version: string, providerKey?: string): StoredRender | undefined {
    if (/^[0-9a-f]{32}$/.test(version)) return this.store.getRenderGeneration(profileId, targetKey(target), version);
    // 升级前的 provider URL 使用 8 位内容哈希。只能恢复旧 last-good 已保存的那一套。
    if (!/^[0-9a-f]{8}$/.test(version) || providerKey === undefined) return undefined;
    const path = `/p/${TOKEN_PLACEHOLDER}/${encodeURIComponent(providerKey)}?v=${version}`;
    // 旧 provider 地址没有 platform，需在该 Profile 已保存的客户端版本中按内容哈希恢复。
    const candidates: Target[] = [target, { client: 'mihomo' }, ...(['android', 'macos', 'windows', 'ios', 'linux'] as const).map(platform => ({ client: 'mihomo' as const, platform }))];
    for (const candidate of candidates) {
      this.preserveLegacy(profileId, candidate);
      const old = this.store.getRenderGeneration<StoredRender>(profileId, targetKey(candidate), 'legacy');
      if (old && (old.yaml.includes(`${path}\n`) || old.yaml.endsWith(path))) return old;
    }
    return undefined;
  }

  private preserveLegacy(profileId: string, target: Target): void {
    const last = this.store.getLastGood<StoredRender>(profileId, targetKey(target));
    if (last && !last.data.generation && !this.store.getRenderGeneration(profileId, targetKey(target), 'legacy')) {
      this.store.putRenderGeneration(profileId, targetKey(target), 'legacy', last.data);
    }
  }

  private remember(profileId: string, target: Target, render: StoredRender): void {
    if (render.generation) this.store.putRenderGeneration(profileId, targetKey(target), render.generation, render);
    this.store.putLastGood(profileId, targetKey(target), render);
  }

  /**
   * 预演：不读写缓存、不更新"上一份成功结果"。用于 Profile 预览，以及模板发布前对现有 Profile 的试渲染（TPL-07 ②）。
   * template 传入时代替 Profile 当前引用的模板版本。
   */
  async preview(profileId: string, target: Target, overrides: { profile?: ProfileDoc; template?: TemplateVersionDoc } = {}): Promise<PreviewOutcome> {
    const pre: ReportItem[] = [];
    try {
      const a = await this.attempt(profileId, target, pre, { dry: true, ...overrides });
      return a.result
        ? { ok: !a.failure, yaml: a.result.yaml, dependencies: a.result.dependencies, report: a.report, ...(a.failure ? { failure: a.failure } : {}) }
        : { ok: false, report: a.report, failure: a.failure ?? '渲染失败' };
    } catch (e) {
      return { ok: false, report: pre, failure: `渲染异常：${(e as Error).message}` };
    }
  }

  /** 新建草稿只使用传入对象，不读取已保存的 Profile，也不读写渲染缓存、last-good 或访问日志。 */
  async previewDraft(profile: ProfileDoc, target: Target): Promise<PreviewOutcome> {
    return this.preview('', target, { profile: { ...profile, id: '' } });
  }

  private async attempt(profileId: string, target: Target, pre: ReportItem[], opts: { dry?: boolean; profile?: ProfileDoc; template?: TemplateVersionDoc } = {}): Promise<Attempt> {
    const profile = opts.profile ?? this.store.get('profile', profileId);
    if (!profile) return { report: pre, failure: 'Profile 不存在' };

    const template = profile.routing?.mode === 'independent' ? undefined : opts.template ?? profileTemplate(profile, (id, v) => this.store.getTemplate(id, v));
    if (profile.template && !template) pre.push({ level: 'error', code: 'template.missing', message: `模板 ${profile.template.id} 不存在` });

    const loaded = await this.loadNodeSets(profile.nodeSets.map((n) => n.ref));
    const nodeSets = loaded.inputs;
    const userinfoBySource = loaded.userinfo;
    const snapshotHashes = loaded.hashes;
    pre.push(...loaded.report);

    const rules = this.collectRules(profile, template);
    for (const rs of Object.values(rules.rulesets) as RuleSetDoc[]) {
      for (const src of rs.sources) {
        if (src.enabled === false || src.kind !== 'remote' || !src.url || src.format === 'mrs' || src.format === 'srs') continue;
        const r = await this.snapshots.get('ruleset', rs.id, src.url, { ttlSec: src.fetch?.ttlSec ?? RULESET_TTL_SEC, ...src.fetch, format: src.format });
        if (r.snapshot?.body !== undefined) {
          rules.snapshots[sourceKey(rs.id, src.id)] = r.snapshot.body;
          snapshotHashes.push(`${rs.id}|${src.url}|${r.snapshot.hash}`);
        }
        if (r.error) pre.push({ level: r.snapshot ? 'warn' : 'error', code: 'ruleset.fetch-failed', message: `规则集「${rs.name}」的来源「${sourceLabel(src)}」拉取失败${r.snapshot ? '，正在使用快照' : ''}：${r.error}`, where: `ruleset:${rs.id}` });
      }
    }

    const preset = profile.base?.presetId ? this.store.get('preset', profile.base.presetId) : undefined;
    if (profile.base?.presetId && !preset) pre.push({ level: 'error', code: 'preset.missing', message: `基础设置预设 ${profile.base.presetId} 不存在` });
    const base = profile.base ? deepMerge(preset?.mihomo ?? {}, profile.base.patch ?? {}) : undefined;
    const userinfo = this.userinfo(profile, userinfoBySource);

    const key = stableHash(stableStringify({
      profile, template, base, target, snapshotHashes,
      sources: nodeSets.sources, collections: nodeSets.collections, locals: nodeSets.locals,
      rulesets: rules.rulesets,
    }));
    const hit = opts.dry ? undefined : this.cache.get(key);
    if (hit && !pre.some(i => i.level === 'error')) {
      // 配置内容未变时仍使用最新快照的流量和本次拉取告警，不把元信息固化在 YAML 缓存中。
      const report = [...pre, ...hit.report];
      const { userinfo: _oldUserinfo, ...content } = hit.render;
      const render: StoredRender = { ...content, warnings: report.filter(i => i.level === 'warn').length, ...(userinfo ? { userinfo } : {}) };
      this.cache.delete(key); this.cache.set(key, { render, report: hit.report });
      this.remember(profileId, target, render);
      return { from: 'cache', render, report };
    }

    const publicUrl = this.opts.publicUrl.replace(/\/$/, '');
    const qs = target.platform ? `&platform=${target.platform}` : '';
    const result = renderMihomo({
      profile, nodeSets, rules,
      ...(template ? { template } : {}),
      ...(target.platform ? { platform: target.platform } : {}),
      ...(base ? { base } : {}),
      urls: {
        provider: (k, v) => `${publicUrl}/p/${TOKEN_PLACEHOLDER}/${encodeURIComponent(k)}?v=${GENERATION_PLACEHOLDER}&h=${v}${qs}`,
        ruleset: (k) => `${publicUrl}/r/${TOKEN_PLACEHOLDER}/${encodeURIComponent(k)}?v=${GENERATION_PLACEHOLDER}${qs}`,
      },
    });
    const report = [...pre, ...result.report.items];
    const errors = report.filter((i) => i.level === 'error');
    if (errors.length) return { report, result, failure: errors.map((e) => e.message).join('；') };

    // 文档意图与主配置结构决定版本。远程快照不参与；兼容的节点/规则内容可在本版本独立更新。
    // provider 的 h 仅用于主配置刷新时破除客户端缓存，不影响结构版本。
    const contract = structuredClone(result.config);
    for (const entry of Object.values((contract['proxy-providers'] ?? {}) as Record<string, { url: string }>)) {
      entry.url = entry.url.replace(/&h=[0-9a-f]+/, '');
    }
    const generation = createHash('sha256').update(stableStringify({
      profile, template, base, target, contract,
      sources: nodeSets.sources, collections: nodeSets.collections, locals: nodeSets.locals,
      rulesets: rules.rulesets,
    })).digest('hex').slice(0, 32);
    result.yaml = result.yaml.replaceAll(GENERATION_PLACEHOLDER, generation);

    if (this.opts.verify) {
      const v = await this.opts.verify(result.yaml.replaceAll(TOKEN_PLACEHOLDER, 'verify'));
      if (!v.ok) {
        report.push({ level: 'error', code: 'verify.mihomo', message: `mihomo -t 校验失败：${v.output.trim().split('\n').slice(-3).join(' ')}` });
        return { report, result, failure: 'mihomo -t 校验失败' };
      }
    }

    const render: StoredRender = {
      generation,
      yaml: result.yaml,
      providers: Object.fromEntries(Object.entries(result.providers).map(([k, p]) => [k, p.yaml])),
      rulesets: Object.fromEntries(Object.entries(result.rulesets).map(([k, r]) => [k, r.text])),
      warnings: report.filter((i) => i.level === 'warn').length,
      ...(userinfo ? { userinfo } : {}),
    };
    if (opts.dry) return { from: 'fresh', render, report, result };
    this.cache.set(key, { render, report: result.report.items });
    while (this.cache.size > (this.opts.cacheSize ?? 256)) this.cache.delete(this.cache.keys().next().value!);
    this.remember(profileId, target, render);
    return { from: 'fresh', render, report };
  }

  /**
   * 收集节点集（含组合成员，递归）并取得远程订阅源的快照。处理链逐步预览也用它。
   * 返回的 hashes 用作缓存键的一部分（用快照哈希而不是正文）。
   */
  async loadNodeSets(refs: NodeSetID[]): Promise<{ inputs: NodeSetInputs; userinfo: Map<string, TrafficInfo>; hashes: string[]; report: ReportItem[] }> {
    const { inputs, sources } = this.collectNodeSets(refs);
    const userinfo = new Map<string, TrafficInfo>();
    const hashes: string[] = [];
    const report: ReportItem[] = [];
    for (const src of sources) {
      const r = await this.snapshots.get('source', src.id, src.url, { ttlSec: src.fetch?.ttlSec ?? SOURCE_TTL_SEC, ...src.fetch });
      if (r.snapshot?.body !== undefined) {
        inputs.snapshots[src.id] = [r.snapshot.body];
        hashes.push(`${src.id}|${src.url}|${r.snapshot.hash}`);
        if (r.snapshot.userinfo) userinfo.set(src.id, r.snapshot.userinfo);
      }
      if (r.error) report.push({ level: r.snapshot ? 'warn' : 'error', code: 'source.fetch-failed', message: `订阅源「${src.name}」拉取失败${r.snapshot ? '，正在使用快照' : ''}：${r.error}`, where: `source:${src.id}` });
    }
    return { inputs, userinfo, hashes, report };
  }

  private collectNodeSets(refs: NodeSetID[]): { inputs: NodeSetInputs; sources: SourceDoc[] } {
    const inputs: NodeSetInputs = { sources: {}, collections: {}, locals: {}, snapshots: {} };
    const seen = new Set<string>();
    const walk = (ref: NodeSetID) => {
      const k = `${ref.type}:${ref.id}`;
      if (seen.has(k)) return;
      seen.add(k);
      if (ref.type === 'source') { const d = this.store.get('source', ref.id); if (d) inputs.sources[d.id] = d; }
      else if (ref.type === 'local') { const d = this.store.get('local', ref.id); if (d) inputs.locals[d.id] = d; }
      else { const d = this.store.get('collection', ref.id); if (d) { inputs.collections[d.id] = d; d.members.forEach((m) => walk(m.ref)); } }
    };
    refs.forEach(walk);
    return { inputs, sources: Object.values(inputs.sources) as SourceDoc[] };
  }

  /** 模板规则与 Profile 私有规则引用到的规则集 */
  private collectRules(profile: ProfileDoc, template: TemplateVersionDoc | undefined): RuleSetInputs {
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
