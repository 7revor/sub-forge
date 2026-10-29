// 规则包并入规则集（2026-10-29）的旧数据转换，存储迁移与种子导入共用。
// - 旧规则集（kind / url / content / format / behavior / overrides / fetch 平铺）→ 只有一个来源的规则集；
// - 旧规则包 → 同 id 的规则集：引用的规则集的来源依次复制进来，单条规则合成一个本地来源；
//   id 与已有规则集冲突时换新 id，模板与 Profile 里的引用由调用方按 idMap 改写。

import { formatRuleLine, parseRuleSourceContent, type RuleIR } from '@sub-forge/core';
import type { RuleSetDoc, RuleSetSourceDoc } from './docs.ts';

type LegacyBundle = {
  id: string;
  name: string;
  noResolve?: boolean;
  items: ({ kind: 'ruleset'; id: string; enabled?: boolean } | { kind: 'rule'; rule: RuleIR; enabled?: boolean })[];
};

/** 已是新结构的原样返回；旧结构转成单一来源。返回 undefined 表示无需改动 */
export function normalizeRuleSet(raw: Record<string, unknown>): RuleSetDoc | undefined {
  if (Array.isArray(raw.sources)) return undefined;
  const { id, name, kind, url, content, format, behavior, overrides, fetch, ...rest } = raw;
  const src: Record<string, unknown> = { id: 's1', kind: kind === 'remote' ? 'remote' : 'local', format: format ?? 'auto' };
  if (kind === 'remote') src.url = url;
  else src.content = typeof content === 'string' ? content : '';
  if (behavior !== undefined) src.behavior = behavior;
  if (Array.isArray(overrides) && overrides.length) src.overrides = overrides;
  if (fetch !== undefined) src.fetch = fetch;
  return { ...rest, id: id as string, name: name as string, sources: [src as unknown as RuleSetSourceDoc] };
}

export type BundleConversion = {
  rulesets: RuleSetDoc[];
  /** 规则包 id → 新规则集 id（多数相同） */
  idMap: Map<string, string>;
  /** 远程来源的快照要从原规则集复制到新规则集名下 */
  snapshotCopies: { from: string; to: string; url: string }[];
};

/**
 * rulesets：已转换为新结构的全部规则集（按 id）；taken：已占用的规则集 id；newId：冲突时生成新 id。
 * 引用的规则集不存在时跳过该子项并给出警告。
 */
export function convertBundles(bundles: LegacyBundle[], rulesets: Map<string, RuleSetDoc>, taken: Set<string>, newId: () => string, warn: (message: string) => void): BundleConversion {
  const out: BundleConversion = { rulesets: [], idMap: new Map(), snapshotCopies: [] };
  for (const b of bundles) {
    let id = b.id;
    while (taken.has(id)) id = newId();
    taken.add(id);
    out.idMap.set(b.id, id);
    const sources: RuleSetSourceDoc[] = [];
    const used = new Set<string>();
    const uniqueId = (base: string) => {
      let sid = base.replace(/[^A-Za-z0-9_-]/g, '_') || 's';
      for (let n = 2; used.has(sid); n++) sid = `${base}-${n}`;
      used.add(sid);
      return sid;
    };
    const lines: Record<'on' | 'off', string[]> = { on: [], off: [] };
    for (const item of b.items ?? []) {
      if (item.kind === 'rule') { lines[item.enabled === false ? 'off' : 'on'].push(formatRuleLine(item.rule)); continue; }
      if (item.kind !== 'ruleset') continue;
      const rs = rulesets.get(item.id);
      if (!rs) { warn(`规则包「${b.name}」引用的规则集 ${item.id} 不存在，已跳过`); continue; }
      for (const src of rs.sources) {
        const copy: RuleSetSourceDoc = { ...structuredClone(src), id: uniqueId(rs.sources.length > 1 ? `${rs.id}-${src.id}` : rs.id), name: src.name ?? rs.name };
        if (rs.overrides?.length) copy.overrides = [...structuredClone(rs.overrides), ...(copy.overrides ?? [])];
        if (item.enabled === false) copy.enabled = false;
        sources.push(copy);
        if (src.kind === 'remote' && src.url) out.snapshotCopies.push({ from: rs.id, to: id, url: src.url });
      }
    }
    if (lines.on.length) sources.push({ id: uniqueId('rules'), name: '单条规则', kind: 'local', format: 'classical', content: lines.on.join('\n') });
    if (lines.off.length) sources.push({ id: uniqueId('rules-off'), name: '单条规则（停用）', kind: 'local', format: 'classical', content: lines.off.join('\n'), enabled: false });
    out.rulesets.push({ id, name: b.name, sources, ...(b.noResolve ? { noResolve: true } : {}) });
  }
  return out;
}

/** 把 { kind: 'bundle', id } 引用改写为 { kind: 'ruleset', id: 新 id } */
export function retargetBundleRefs(value: unknown, idMap: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((v) => retargetBundleRefs(v, idMap));
  if (!value || typeof value !== 'object') return value;
  const o = value as Record<string, unknown>;
  if (o.kind === 'bundle' && typeof o.id === 'string' && Object.keys(o).length === 2) return { kind: 'ruleset', id: idMap.get(o.id) ?? o.id };
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, retargetBundleRefs(v, idMap)]));
}

/** 将可定位的旧来源改写提升为组级内容匹配；无法确认时保留整个来源的旧配置及优先级。 */
export function promoteRuleSetOverrides(rs: RuleSetDoc, snapshot: (src: RuleSetSourceDoc) => string | undefined): RuleSetDoc {
  const overrides = [...(rs.overrides ?? [])];
  const seen = new Set(overrides.map((o) => JSON.stringify(o)));
  const sources = rs.sources.map((src) => {
    if (!src.overrides?.length || src.enabled === false) return src;
    const content = src.kind === 'local' ? src.content : snapshot(src);
    const parsed = content === undefined ? undefined : parseRuleSourceContent(content, src);
    const promoted: NonNullable<RuleSetDoc['overrides']> = [];
    for (const item of src.overrides) {
      const matches = new Set<string>();
      if (item.match?.trim()) matches.add(item.match);
      if (item.line !== undefined) {
        const row = parsed && !parsed.passthrough ? parsed.rules.find((r) => r.line === item.line) : undefined;
        if (!row) return src;
        matches.add(row.text);
      }
      if (!matches.size) return src;
      for (const match of matches) promoted.push({ match, override: item.override });
    }
    for (const item of promoted) {
      const key = JSON.stringify(item);
      if (!seen.has(key)) { seen.add(key); overrides.push(item); }
    }
    const { overrides: _, ...clean } = src;
    return clean;
  });
  return { ...rs, sources, ...(overrides.length ? { overrides } : {}) };
}
