import type { Matcher, RuleSetSource } from '../types.ts';
import { stableHash } from '../util/hash.ts';

/** 外部引用只持有 URL；派生键仅隔离缓存，不指向系统规则集记录。 */
export function normalizeRuleUrl(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 8192) throw new Error('请填写有效的远程规则 URL');
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('请填写完整的 http(s) 规则地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('规则地址必须是无用户名密码的 http(s) URL');
  url.hash = '';
  return url.href;
}

export function remoteRuleMatcher(value: string): Extract<Matcher, { kind: 'ruleset' }> {
  const url = normalizeRuleUrl(value);
  return { kind: 'ruleset', id: `remote:${stableHash(url)}`, remote: { url } };
}

/** 只有已知 Clash 路径采用 Clash 域名方言，其他来源保持原有 DOMAIN-SET 语义。 */
export function usesClashDomains(source: Pick<RuleSetSource, 'format' | 'repository' | 'url'>): boolean {
  if (source.format === 'domain' || source.repository?.path.startsWith('rule/Clash/')) return true;
  if (!source.url) return false;
  try {
    const u = new URL(source.url);
    return u.hostname === 'raw.githubusercontent.com' && (/^\/MetaCubeX\/meta-rules-dat\/[^/]+\/geo\/geosite\//i.test(u.pathname) || /\/rule\/Clash\//.test(u.pathname));
  } catch { return false; }
}
