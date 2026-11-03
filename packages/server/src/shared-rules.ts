// 规则文件按需从上游内容转换，结果不落库；与用户 token、节点订阅无关。读取权限由路由负责。
import { createHash } from 'node:crypto';
import { managedRuleDelivery, renderMihomo, renderStash, renderSurge, renderLoon, ruleProviderName, sourceKey, stableStringify, type HostedRuleReference, type Matcher, type RuleSetInputs } from '@sub-forge/core';
import type { RuleSetDoc } from './docs.ts';
type Target = { client: import('@sub-forge/core').Client };
import { resolveRuleSetReference } from './ruleset-reference.ts';
import type { SnapshotService } from './snapshots.ts';
import type { Store } from './store.ts';

export type SharedRuleOutput = { body: string; name: string };
const isRuleset = (matcher: Matcher): matcher is Extract<Matcher, { kind: 'ruleset' }> => matcher.kind === 'ruleset';

export class SharedRuleService {
  private readonly inflight = new Map<string, Promise<SharedRuleOutput | undefined>>();
  constructor(private store: Store, private snapshots: SnapshotService) {}

  /**
   * 同一身份和内核的并发读取共用一次转换；定义失效返回 undefined，上游失败抛错。
   * 手写规则（Loon 的 rule、local）没有规则集文档，definition 只提供名称并复核规则仍然有效。
   */
  read(reference: HostedRuleReference, target: Target, definition: () => RuleSetDoc | undefined = () => isRuleset(reference.matcher) ? resolveRuleSetReference(reference.matcher, this.store) : undefined): Promise<SharedRuleOutput | undefined> {
    const key = createHash('sha256').update(stableStringify({ matcher: reference.matcher, src: !!reference.options?.src, client: target.client })).digest('hex');
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const matcherId = isRuleset(reference.matcher) ? reference.matcher.id : undefined;
    const repositories = new Set(definition()?.sources.flatMap(source => source.repository ? [source.repository.repo] : []));
    let cancelled = false;
    const invalidate = (kind: string, id: string) => { if (kind === 'ruleset' && id === matcherId || kind === 'repository' && repositories.has(id)) cancelled = true; };
    this.store.invalidationListeners.add(invalidate);
    const work = this.compile(reference, target, definition, () => cancelled)
      .finally(() => { this.inflight.delete(key); this.store.invalidationListeners.delete(invalidate); });
    this.inflight.set(key, work);
    return work;
  }

  private async compile(reference: HostedRuleReference, target: Target, definition: () => RuleSetDoc | undefined, cancelled: () => boolean, attempt = 0): Promise<SharedRuleOutput | undefined> {
    if (cancelled()) return undefined;
    const rs = definition();
    if (!rs) return undefined;
    const { matcher } = reference;
    if (isRuleset(matcher)) {
      const delivery = managedRuleDelivery(rs, target, reference.options);
      if (delivery.mode !== 'managed') throw new Error(delivery.reason);
    }
    const rules: RuleSetInputs = { rulesets: { [rs.id]: rs }, snapshots: {} };
    const remote = rs.sources.filter(s => s.enabled !== false && s.kind === 'remote');
    const results = await Promise.all(remote.map(src => this.snapshots.getRuleContent(src.url!, { ...src.fetch, format: src.format, behavior: src.behavior })));
    if (cancelled() || !definition()) return undefined;
    if (stableStringify(definition()) !== stableStringify(rs)) {
      if (attempt >= 2) throw new Error('规则资源在生成期间持续变化，请重试');
      return this.compile(reference, target, definition, cancelled, attempt + 1);
    }
    for (const [index, src] of remote.entries()) rules.snapshots[sourceKey(rs.id, src.id)] = results[index]!.body;
    const result = (target.client === 'loon' ? renderLoon : target.client === 'surge' ? renderSurge : target.client === 'stash' ? renderStash : renderMihomo)({
      profile: { id: '$shared-rule', name: rs.name, nodeSets: [], chains: [], routing: { mode: 'independent', config: {
        groups: [], rules: [{ id: 'rule', matcher, options: reference.options, target: { kind: 'builtin', name: 'DIRECT' } }], final: { kind: 'builtin', name: 'DIRECT' },
      } } },
      nodeSets: { sources: {}, locals: {}, collections: {}, snapshots: {} }, rules,
      urls: { provider: key => key, ruleset: key => key },
    });
    if (result.report.hasErrors) throw new Error(result.report.items.filter(i => i.level === 'error').map(i => i.message).join('；'));
    // 主配置不解析正文就声明了 provider，全部规则都不适用于该内核时也要返回合法的空规则文件。
    const body = Object.values(result.rulesets)[0]?.text ?? `# 规则集没有可用于 ${target.client} 的规则\n`;
    return { body, name: isRuleset(matcher) ? ruleProviderName(matcher, rs) : rs.name };
  }
}
