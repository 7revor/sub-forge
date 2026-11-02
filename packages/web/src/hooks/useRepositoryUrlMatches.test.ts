import { describe, expect, it } from 'vitest';
import { resolveRepositoryUrlMatches, uniqueRepositoryMatches, type RepositoryUrlMatch, type RuleSetMatcher } from './useRepositoryUrlMatches.ts';

const match = (path: string): RepositoryUrlMatch => ({ repo: 'repo', entry: 'entry', ref: 'main', path, label: path, hint: path });
const matcher: RuleSetMatcher = { kind: 'ruleset', id: 'resolved' };

describe('一键关联候选', () => {
  it('只保留唯一候选，并按地址去重', () => {
    const matches = { a: [match('a')], b: [match('b1'), match('b2')], c: [] };
    expect(uniqueRepositoryMatches(['a', 'a', 'b', 'c', 'missing'], matches)).toEqual({ a: matches.a[0] });
  });
  it('单项失败不影响其余项', async () => {
    const result = await resolveRepositoryUrlMatches({ a: match('a'), b: match('b'), c: match('c') }, async url => {
      if (url === 'b') throw new Error('索引已更新');
      return matcher;
    });
    expect([...result.resolved.keys()].sort()).toEqual(['a', 'c']);
    expect(result.failures).toEqual(['索引已更新']);
  });
  it('限制并发并处理全部地址', async () => {
    let active = 0, peak = 0;
    const urls = Array.from({ length: 20 }, (_, i) => `u${i}`);
    const result = await resolveRepositoryUrlMatches(Object.fromEntries(urls.map(url => [url, match(url)])), async () => {
      peak = Math.max(peak, ++active);
      await new Promise(done => setTimeout(done, 1));
      active--;
      return matcher;
    });
    expect(result.resolved.size).toBe(20);
    expect(peak).toBe(4);
  });
});
