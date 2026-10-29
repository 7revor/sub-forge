import { describe, expect, it, vi, afterEach } from 'vitest';
import { buildRuleCatalog, ruleCatalogLoader } from './ruleCatalog.ts';
import type { RuleCatalog } from '../api.ts';

afterEach(() => vi.unstubAllGlobals());
const catalog = (items: RuleCatalog['items']): RuleCatalog => ({ items, total: 75, offset: 0, limit: 30, nextOffset: 30, notices: ['索引待更新'] });

describe('规则目录分页映射', () => {
  it('只转换本页，目录保持未加载，分页游标与告警透传', () => {
    const page = buildRuleCatalog(catalog([{ kind: 'local', id: 'local', name: '本地规则', hint: '1 个来源' },
      { kind: 'repository', repo: 'black', name: 'blackmatrix7' }, { kind: 'directory', repo: 'black', path: 'rule/Clash/Cloud/Dropbox', name: 'Dropbox' }]));
    expect(page).toMatchObject({ total: 75, nextOffset: 30, notices: ['索引待更新'] });
    expect(page.options[0]?.label).toBe('本地 · 本地规则');
    expect(page.options.slice(1).every(option => option.branch && !('children' in option))).toBe(true);
    expect(JSON.parse(page.options[2]!.value)).toEqual({ kind: 'directory', repo: 'black', path: 'rule/Clash/Cloud/Dropbox' });
  });

  it('不同原始目录下的同名子目录保留各自路径，不按名称合并', () => {
    const page = buildRuleCatalog(catalog([
      { kind: 'directory', repo: 'black', path: 'rule/Clash/China', name: 'China' },
      { kind: 'directory', repo: 'black', path: 'rule/Surge/China', name: 'China' },
    ]));
    expect(page.options).toHaveLength(2);
    expect(new Set(page.options.map(option => option.value)).size).toBe(2);
    expect(page.options.map(option => JSON.parse(option.value).path)).toEqual(['rule/Clash/China', 'rule/Surge/China']);
  });

  it('同名文件保留路径与分支身份，不可关联文件仍可供仓库预览', () => {
    const page = buildRuleCatalog(catalog([
      { kind: 'file', repo: 'black', path: 'rule/Clash/China/China.list', name: 'China.list', ref: 'master', entry: 'China' },
      { kind: 'file', repo: 'black', path: 'rule/Surge/China/China.list', name: 'China.list', ref: 'master', entry: 'China' },
      { kind: 'file', repo: 'black', path: 'rule/Clash/China/China.list', name: 'China.list', ref: 'other', entry: 'China' },
      { kind: 'file', repo: 'black', path: 'ignored.txt', name: 'ignored.txt', ref: 'master' },
    ]));
    expect(new Set(page.options.map(option => option.value)).size).toBe(4);
    expect(page.options[3]?.disabled).toBe(true);
    expect(JSON.parse(page.options[0]!.value)).toEqual({ source: 'repository', repo: 'black', entry: 'China', file: { ref: 'master', path: 'rule/Clash/China/China.list' } });
  });

  it('三处共用加载器明确传递分页、搜索与父目录，不自动取后续页', async () => {
    const fetch = vi.fn(async (_url: string, _options?: RequestInit) => new Response(JSON.stringify(catalog([])), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    const loader = ruleCatalogLoader('all');
    await loader('未加载文件', 30, JSON.stringify({ kind: 'directory', repo: 'black', path: 'rule/Clash/Cloud/Dropbox' }));
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetch.mock.calls[0]![0]), 'http://localhost');
    expect(Object.fromEntries(url.searchParams)).toEqual({ scope: 'all', q: '未加载文件', offset: '30', limit: '30', repo: 'black', directory: 'rule/Clash/Cloud/Dropbox' });
  });
});
