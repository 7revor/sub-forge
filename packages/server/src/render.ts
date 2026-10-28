// 渲染服务：从存储组装内核输入 → 渲染 → 校验 → 缓存；失败时返回上一份成功结果（OUT-05 / TPL-12）。
// 渲染结果与 token 无关：地址里先写占位符，下发时再替换成请求所用的 token，
// 这样同一 Profile 的多个订阅链接共用缓存与"上一份成功结果"。

import {
  renderMihomo, stableHash, stableStringify,
  type Matcher, type NodeSetID, type NodeSetInputs, type Platform, type ReportItem, type RuleSetInputs,
} from '@sub-forge/core';
import type { ProfileDoc, RuleSetDoc, SourceDoc, TemplateVersionDoc } from './docs.ts';
import type { SnapshotService } from './snapshots.ts';
import type { Store, TrafficInfo } from './store.ts';

export const TOKEN_PLACEHOLDER = '__SF_TOKEN__';

export type Target = { client: 'mihomo'; platform?: Platform };

/** 可下发的渲染结果（也是"上一份成功结果"的存储格式） */
export type StoredRender = {
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

const SOURCE_TTL_SEC = 3600;
const RULESET_TTL_SEC = 86400;

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

type Attempt = { from?: 'fresh' | 'cache'; render?: StoredRender; report: ReportItem[]; failure?: string };

const targetKey = (t: Target) => `${t.client}:${t.platform ?? 'any'}`;

export class RenderService {
  private readonly cache = new Map<string, StoredRender>();

  constructor(
    private readonly store: Store,
    private readonly snapshots: SnapshotService,
    private readonly opts: RenderServiceOptions,
  ) {}

  async render(profileId: string, target: Target): Promise<RenderOutcome> {
    const pre: ReportItem[] = [];
    let attempt: Attempt;
    try {
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

  private async attempt(profileId: string, target: Target, pre: ReportItem[]): Promise<Attempt> {
    const profile = this.store.get('profile', profileId);
    if (!profile) return { report: pre, failure: 'Profile 不存在' };

    const template = profile.template ? this.store.getTemplate(profile.template.id, profile.template.follow === 'latest' ? undefined : profile.template.follow.pinned) : undefined;
    if (profile.template && !template) pre.push({ level: 'error', code: 'template.missing', message: `模板 ${profile.template.id} 不存在` });

    const { inputs: nodeSets, sources } = this.collectNodeSets(profile);
    const userinfoBySource = new Map<string, TrafficInfo>();
    // 缓存键用快照哈希而不是正文
    const snapshotHashes: string[] = [];
    for (const src of sources) {
      const bodies: string[] = [];
      for (const url of src.urls ?? []) {
        const r = await this.snapshots.get('source', src.id, url, { ttlSec: src.fetch?.ttlSec ?? SOURCE_TTL_SEC, ...src.fetch });
        if (r.snapshot?.body !== undefined) {
          bodies.push(r.snapshot.body);
          snapshotHashes.push(`${src.id}|${url}|${r.snapshot.hash}`);
          if (r.snapshot.userinfo) userinfoBySource.set(src.id, r.snapshot.userinfo);
        }
        if (r.error) pre.push({ level: r.snapshot ? 'warn' : 'error', code: 'source.fetch-failed', message: `订阅源「${src.name}」拉取失败${r.snapshot ? '，正在使用快照' : ''}：${r.error}`, where: `source:${src.id}` });
      }
      if (bodies.length) nodeSets.snapshots[src.id] = bodies;
    }

    const rules = this.collectRules(profile, template);
    for (const rs of Object.values(rules.rulesets) as RuleSetDoc[]) {
      if (rs.kind !== 'remote' || !rs.url || rs.format === 'mrs' || rs.format === 'srs') continue;
      const r = await this.snapshots.get('ruleset', rs.id, rs.url, { ttlSec: rs.fetch?.ttlSec ?? RULESET_TTL_SEC, ...rs.fetch });
      if (r.snapshot?.body !== undefined) {
        rules.snapshots[rs.id] = r.snapshot.body;
        snapshotHashes.push(`${rs.id}|${rs.url}|${r.snapshot.hash}`);
      }
      if (r.error) pre.push({ level: r.snapshot ? 'warn' : 'error', code: 'ruleset.fetch-failed', message: `规则集「${rs.name}」拉取失败${r.snapshot ? '，正在使用快照' : ''}：${r.error}`, where: `ruleset:${rs.id}` });
    }

    const preset = profile.base?.presetId ? this.store.get('preset', profile.base.presetId) : undefined;
    if (profile.base?.presetId && !preset) pre.push({ level: 'error', code: 'preset.missing', message: `基础设置预设 ${profile.base.presetId} 不存在` });
    const base = profile.base ? deepMerge(preset?.mihomo ?? {}, profile.base.patch ?? {}) : undefined;

    const key = stableHash(stableStringify({
      profile, template, base, target, snapshotHashes,
      sources: nodeSets.sources, collections: nodeSets.collections, locals: nodeSets.locals,
      rulesets: rules.rulesets, bundles: rules.bundles,
    }));
    const hit = this.cache.get(key);
    if (hit) { this.cache.delete(key); this.cache.set(key, hit); return { from: 'cache', render: hit, report: pre }; }

    const publicUrl = this.opts.publicUrl.replace(/\/$/, '');
    const qs = target.platform ? `?platform=${target.platform}` : '';
    const result = renderMihomo({
      profile, nodeSets, rules,
      ...(template ? { template } : {}),
      ...(target.platform ? { platform: target.platform } : {}),
      ...(base ? { base } : {}),
      urls: {
        provider: (k, v) => `${publicUrl}/p/${TOKEN_PLACEHOLDER}/${encodeURIComponent(k)}?v=${v}`,
        ruleset: (k) => `${publicUrl}/r/${TOKEN_PLACEHOLDER}/${encodeURIComponent(k)}${qs}`,
      },
    });
    const report = [...pre, ...result.report.items];
    const errors = report.filter((i) => i.level === 'error');
    if (errors.length) return { report, failure: errors.map((e) => e.message).join('；') };

    if (this.opts.verify) {
      const v = await this.opts.verify(result.yaml.replaceAll(TOKEN_PLACEHOLDER, 'verify'));
      if (!v.ok) {
        report.push({ level: 'error', code: 'verify.mihomo', message: `mihomo -t 校验失败：${v.output.trim().split('\n').slice(-3).join(' ')}` });
        return { report, failure: 'mihomo -t 校验失败' };
      }
    }

    const userinfo = this.userinfo(profile, userinfoBySource);
    const render: StoredRender = {
      yaml: result.yaml,
      providers: Object.fromEntries(Object.entries(result.providers).map(([k, p]) => [k, p.yaml])),
      rulesets: Object.fromEntries(Object.entries(result.rulesets).map(([k, r]) => [k, r.text])),
      warnings: report.filter((i) => i.level === 'warn').length,
      ...(userinfo ? { userinfo } : {}),
    };
    this.cache.set(key, render);
    while (this.cache.size > (this.opts.cacheSize ?? 256)) this.cache.delete(this.cache.keys().next().value!);
    this.store.putLastGood(profileId, targetKey(target), render);
    return { from: 'fresh', render, report };
  }

  /** Profile 用到的节点集（含组合的成员，递归） */
  private collectNodeSets(profile: ProfileDoc): { inputs: NodeSetInputs; sources: SourceDoc[] } {
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
    profile.nodeSets.forEach((n) => walk(n.ref));
    const sources = (Object.values(inputs.sources) as SourceDoc[]).filter((s) => s.kind === 'remote');
    return { inputs, sources };
  }

  /** 模板规则与 Profile 私有规则引用到的规则集 / 规则包 */
  private collectRules(profile: ProfileDoc, template: TemplateVersionDoc | undefined): RuleSetInputs {
    const out: RuleSetInputs = { rulesets: {}, bundles: {}, snapshots: {} };
    const addRuleset = (id: string) => { const d = this.store.get('ruleset', id); if (d) out.rulesets[id] = d; };
    const visit = (m: Matcher) => {
      if (m.kind === 'ruleset') addRuleset(m.id);
      else if (m.kind === 'bundle') {
        const b = this.store.get('bundle', m.id);
        if (!b) return;
        out.bundles[b.id] = b;
        for (const i of b.items) if (i.kind === 'ruleset') addRuleset(i.id);
      }
    };
    template?.rules.forEach((r) => visit(r.matcher));
    profile.overlay.extraRules?.forEach((r) => visit(r.rule.matcher));
    return out;
  }

  private userinfo(profile: ProfileDoc, bySource: Map<string, TrafficInfo>): TrafficInfo | undefined {
    const mode = profile.userinfo ?? { mode: 'sum' };
    if (mode.mode === 'none') return undefined;
    if (mode.mode === 'source') return bySource.get(mode.sourceId);
    if (!bySource.size) return undefined;
    const sum: TrafficInfo = {};
    for (const u of bySource.values()) {
      for (const k of ['upload', 'download', 'total'] as const) if (u[k] !== undefined) sum[k] = (sum[k] ?? 0) + u[k]!;
      if (u.expire !== undefined) sum.expire = sum.expire === undefined ? u.expire : Math.min(sum.expire, u.expire);
    }
    return sum;
  }
}
