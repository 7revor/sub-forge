// 公共规则产物按规则身份、处理参数和客户端共享；与用户 token、配置订阅无关。
import { createHash } from 'node:crypto';
import { renderMihomo, renderStash, ruleProviderName, sourceKey, stableStringify, type RuleResourceReference, type RuleSetInputs } from '@sub-forge/core';
import type { RuleSetDoc } from './docs.ts';
import type { Target } from './render.ts';
import { resolveRuleSetReference } from './ruleset-reference.ts';
import type { SnapshotService } from './snapshots.ts';
import type { Store } from './store.ts';

export type SharedRuleRecord = {
  reference: RuleResourceReference;
  target: Target;
  name: string;
  inputHash: string;
  body: string;
  error?: string;
};
const hash = (value: unknown) => createHash('sha256').update(stableStringify(value)).digest('hex');
const canonical = (ref: RuleResourceReference): RuleResourceReference => ({ matcher: ref.matcher, ...(ref.options?.src ? { options: { src: true } } : {}) });

export class SharedRuleService {
  private readonly inflight = new Map<string, Promise<string | undefined>>();
  constructor(private store: Store, private snapshots: SnapshotService) {}

  key(reference: RuleResourceReference, target: Target): string {
    const m = reference.matcher;
    const identity = m.remote ? { url: m.remote.url } : m.repository ? { repo: m.repository.repo, entry: m.repository.entry, sources: m.repository.sources } : { id: m.id };
    return hash({ identity, options: canonical(reference).options, target });
  }
  private inputHash(rs: RuleSetDoc, rules: RuleSetInputs, reference: RuleResourceReference, target: Target): string {
    return hash({ version: 1, rs, target, options: canonical(reference).options, bodies: rs.sources.filter(s => s.enabled !== false).map(s => s.kind === 'local' ? s.content : rules.snapshots[sourceKey(rs.id, s.id)]) });
  }
  register(reference: RuleResourceReference, target: Target, rs: RuleSetDoc, rules: RuleSetInputs, body: string): void {
    this.store.putSharedRule(this.key(reference, target), rs.id, {
      reference: canonical(reference), target, name: ruleProviderName(reference.matcher, rs),
      inputHash: this.inputHash(rs, rules, reference, target), body,
    } satisfies SharedRuleRecord);
  }
  read(key: string): Promise<string | undefined> {
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const work = this.compile(key).catch(error => {
      const record = this.store.getSharedRule<SharedRuleRecord>(key);
      if (!record || !resolveRuleSetReference(record.reference.matcher, this.store)) return undefined;
      const message = error instanceof Error ? error.message : String(error);
      this.store.putSharedRule(key, record.reference.matcher.id, { ...record, error: message });
      console.warn(`公共规则生成失败，保留上次成功结果：${key}：${message}`);
      return record.body;
    }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, work);
    return work;
  }
  private async compile(key: string, attempt = 0): Promise<string | undefined> {
    const record = this.store.getSharedRule<SharedRuleRecord>(key);
    if (!record) return undefined;
    const rs = resolveRuleSetReference(record.reference.matcher, this.store);
    if (!rs) { this.store.deleteSharedRule(key); return undefined; }
    const rules: RuleSetInputs = { rulesets: { [rs.id]: rs }, snapshots: {} };
    const loaded = [];
    for (const src of rs.sources.filter(s => s.enabled !== false && s.kind === 'remote')) {
      const result = await this.snapshots.get('ruleset', rs.id, src.url!, { ...src.fetch, format: src.format, behavior: src.behavior, scope: 'public-rules' });
      if (!result.snapshot?.body) throw new Error(`规则来源没有可用内容：${result.error ?? src.name ?? src.id}`);
      rules.snapshots[sourceKey(rs.id, src.id)] = result.snapshot.body;
      loaded.push(result);
    }
    if (!this.store.getSharedRule(key)) return undefined;
    const current = resolveRuleSetReference(record.reference.matcher, this.store);
    if (!current) return undefined;
    if (stableStringify(current) !== stableStringify(rs) || loaded.some(r => !this.snapshots.isCurrent(r.snapshot!, r.revision))) {
      if (attempt >= 2) throw new Error('规则资源在生成期间持续变化，请重试');
      return this.compile(key, attempt + 1);
    }
    const inputHash = this.inputHash(rs, rules, record.reference, record.target);
    if (record.inputHash === inputHash) {
      if (record.error) this.store.putSharedRule(key, rs.id, { ...record, error: undefined });
      return record.body;
    }
    const result = (record.target.client === 'stash' ? renderStash : renderMihomo)({
      profile: { id: '$shared-rule', name: rs.name, nodeSets: [], chains: [], overlay: {}, refPolicy: { default: 'wrap' }, routing: { mode: 'independent', config: {
        groups: [], rules: [{ id: 'rule', matcher: record.reference.matcher, options: record.reference.options, target: { kind: 'builtin', name: 'DIRECT' } }], final: { kind: 'builtin', name: 'DIRECT' },
      } } },
      nodeSets: { sources: {}, locals: {}, collections: {}, snapshots: {} }, rules, platform: record.target.platform,
      urls: { provider: key => key, ruleset: key => key },
    });
    if (result.report.hasErrors) throw new Error(result.report.items.filter(i => i.level === 'error').map(i => i.message).join('；'));
    const body = Object.values(result.rulesets)[0]?.text;
    if (body === undefined) throw new Error('规则资源没有可用输出');
    this.store.putSharedRule(key, rs.id, { ...record, inputHash, name: ruleProviderName(record.reference.matcher, rs), body, error: undefined });
    return body;
  }
}
