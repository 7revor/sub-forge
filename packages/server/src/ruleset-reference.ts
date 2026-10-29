import { createHash } from 'node:crypto';
import { normalizeRuleUrl, remoteRuleMatcher, stableStringify, type Matcher, type RepositoryRuleSetReference } from '@sub-forge/core';
import type { RuleSetDoc } from './docs.ts';
import type { Store } from './store.ts';
import { bad, isStr } from './api/common.ts';
import { checkRepositorySource } from './api/validate.ts';

export type RuleSetMatcher = Extract<Matcher, { kind: 'ruleset' }>;

/** 映射身份与显示名称分离；不同文件/分支/格式不能共用缓存和 provider。 */
export function repositoryReferenceId(ref: RepositoryRuleSetReference): string {
  return `repo:${createHash('sha256').update(stableStringify({ repo: ref.repo, entry: ref.entry, sources: ref.sources })).digest('hex').slice(0, 32)}`;
}

export function repositoryMatcher(ref: RepositoryRuleSetReference): RuleSetMatcher {
  return { kind: 'ruleset', id: repositoryReferenceId(ref), repository: ref };
}

/** 新引用必须来自索引；历史引用保持原映射，仓库停用或索引变化不会替换文件。 */
export function checkRuleSetReference(matcher: RuleSetMatcher, store: Store, prior?: RuleSetMatcher): void {
  if (!isStr(matcher.id)) throw bad('请选择规则集');
  if (matcher.remote !== undefined) {
    if (matcher.repository !== undefined || !matcher.remote || typeof matcher.remote !== 'object' || Object.keys(matcher.remote).some(k => k !== 'url')) throw bad('远程 URL 不能同时引用系统规则集');
    try {
      const expected = remoteRuleMatcher(matcher.remote.url);
      if (matcher.id !== expected.id || matcher.remote.url !== normalizeRuleUrl(matcher.remote.url)) throw new Error('远程规则 URL 与引用身份不一致');
    } catch (error) { throw bad(error instanceof Error ? error.message : String(error)); }
    return;
  }
  if (matcher.id.startsWith('remote:')) throw bad('远程规则缺少 URL');
  const ref = matcher.repository;
  if (ref === undefined) {
    if (matcher.id?.startsWith('repo:')) throw bad('仓库规则集缺少文件映射，请重新选择');
    return;
  }
  if (!ref || !isStr(ref.repo) || !isStr(ref.entry) || !isStr(ref.name) || !Array.isArray(ref.sources) || !ref.sources.length) throw bad('仓库规则集引用格式错误');
  if (matcher.id !== repositoryReferenceId(ref)) throw bad('仓库规则集引用身份与文件映射不一致');
  const saved = prior?.repository && prior.id === matcher.id && stableStringify(prior.repository) === stableStringify(ref);
  const ids = new Set<string>();
  for (const src of ref.sources) {
    if (!src || !isStr(src.id) || ids.has(src.id) || src.kind !== 'remote' || !src.repository || src.repository.repo !== ref.repo || src.repository.entry !== ref.entry || !['auto', 'classical', 'domain', 'domain-set', 'ipcidr'].includes(src.format)) throw bad('仓库规则集文件映射不合法');
    if (Object.keys(src).some(k => !['id', 'kind', 'name', 'url', 'format', 'behavior', 'repository'].includes(k))) throw bad('仓库引用不支持内容定制，请创建本地规则集');
    if (Object.keys(src.repository).some(k => !['repo', 'entry', 'ref', 'path'].includes(k))) throw bad('仓库文件关联包含未知字段');
    ids.add(src.id);
    checkRepositorySource(src, saved ? src : undefined, store, '仓库规则集');
    // 自动识别保留文件内容的真实格式，不接受伪造的客户端格式声明。
    if (src.format !== 'auto') throw bad('仓库规则集必须自动识别文本格式');
  }
}

/** 两类引用统一送入现有快照、解析与渲染链路。 */
export function resolveRuleSetReference(matcher: RuleSetMatcher, store: Store): RuleSetDoc | undefined {
  if (matcher.remote) return { id: matcher.id, name: matcher.remote.url, sources: [{ id: 'remote', kind: 'remote', url: matcher.remote.url, format: 'auto' }] };
  return matcher.repository
    ? { id: matcher.id, name: matcher.repository.name, sources: matcher.repository.sources }
    : store.get('ruleset', matcher.id);
}
