import { describe, expect, it, vi, afterEach } from 'vitest';
import { ruleOptionsLoader } from './ruleOptions.ts';

afterEach(() => vi.unstubAllGlobals());
describe('规则文件分页加载器', () => {
  it.each(['all', 'repository'] as const)('%s 只请求指定的一页，保留服务端文件身份与分页信息', async scope => {
    const items = ['Clash', 'Surge'].map(directory => ({ value: JSON.stringify({ source: 'repository', repo: 'matrix', entry: 'China', file: { ref: 'master', path: `${directory}/China.list` } }), label: 'China.list', hint: `matrix · ${directory}/`, disabled: false, matches: { label: [{ start: 0, end: 5 }], hint: [] } }));
    const result = { items, total: 75, offset: 30, limit: 30, nextOffset: 60, notices: ['索引待更新'] };
    const fetch = vi.fn(async (_url: string, _options?: RequestInit) => new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    const page = await ruleOptionsLoader(scope)('China', 30);
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetch.mock.calls[0]![0]), 'http://localhost');
    expect(url.pathname).toBe('/api/rule-options/search');
    expect(Object.fromEntries(url.searchParams)).toEqual({ scope, q: 'China', offset: '30', limit: '30' });
    expect(page).toEqual({ options: items, total: 75, offset: 30, limit: 30, nextOffset: 60, notices: ['索引待更新'] });
  });
});
