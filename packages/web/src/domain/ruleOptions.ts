import { api, type RuleOptions } from '../api.ts';
import type { OptionLoader } from '../components/OptionPage.tsx';

export type RuleSelection = { source: 'local'; id: string } | { source: 'repository'; repo: string; entry: string; file: { ref: string; path: string } };

/** 三处选择器和仓库页共用；一次只读取当前查询的一页物理文件。 */
export const ruleOptionsLoader = (scope: 'all' | 'repository', pageSize = 10): OptionLoader => async (query, offset) => {
  const params = new URLSearchParams({ scope, q: query, offset: String(offset), limit: String(pageSize) });
  const { items, ...page } = await api<RuleOptions>('GET', `/rule-options/search?${params}`);
  return { ...page, options: items };
};
