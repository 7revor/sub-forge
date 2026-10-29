import { describe, expect, it } from 'vitest';
import { buildRuleCatalog } from './ruleCatalog.ts';
import type { RuleCatalog } from '../api.ts';

const node = (path: string, kind: 'file' | 'directory' = 'file', root = 'rule/Clash', ref = 'master') => ({ path, root, ref, kind, ...(kind === 'file' ? { entry: path } : {}) });
describe('前端目录级联组装', () => {
  it('扫描根不占层级，根文件直排，真实子目录嵌套，重名文件不混用', () => {
    const catalog: RuleCatalog = { locals: [{ id: 'local', name: '本地规则', hint: '1 个来源' }], notices: [], repositories: [{ id: 'black', name: 'blackmatrix7', complete: true, nodes: [
      node('rule/Clash', 'directory'), node('rule/Clash/root.list'), node('rule/Clash/China', 'directory'), node('rule/Clash/China/China.list'),
      node('rule/Surge/China/China.list', 'file', 'rule/Surge'), node('rule/Clash/Cloud/Dropbox', 'directory'), node('rule/Clash/Cloud/Dropbox/Dropbox.txt'),
      node('rule/Clash/China/China.list'), { ...node('rule/Clash/ignored.txt'), entry: undefined },
    ] }] };
    const tree = buildRuleCatalog(catalog);
    expect(tree[0]?.label).toBe('本地 · 本地规则');
    const repo = tree[1]!;
    expect(repo.children?.map(option => option.label)).toEqual(['China', 'Cloud', 'ignored.txt', 'root.list']);
    const china = repo.children![0]!;
    expect(china.children).toHaveLength(2);
    expect(new Set(china.children!.map(option => option.value)).size).toBe(2);
    expect(china.children!.every(option => option.hint?.includes('分支：master'))).toBe(true);
    expect(repo.children![1]!.children![0]!.children![0]!.label).toBe('Dropbox.txt');
    expect(repo.children!.find(option => option.label === 'ignored.txt')?.disabled).toBe(true);
    expect(JSON.parse(repo.children!.find(option => option.label === 'root.list')!.value).file.path).toBe('rule/Clash/root.list');
  });
  it('整个仓库作为扫描根时保留真实目录，同一路径跨分支仍为独立叶子', () => {
    const catalog: RuleCatalog = { locals: [], notices: [], repositories: [{ id: 'custom', name: '自定义', complete: true, nodes: [node('', 'directory', ''), node('root.txt', 'file', '', 'one'), node('root.txt', 'file', '', 'two'), node('Parent/Child', 'directory', ''), node('Parent/Child/deep.list', 'file', '')] }] };
    const children = buildRuleCatalog(catalog)[0]!.children!;
    expect(children.map(option => option.label)).toEqual(['Parent', 'root.txt', 'root.txt']);
    expect(children[0]!.children![0]!.label).toBe('Child');
    expect(children[1]!.value).not.toBe(children[2]!.value);
  });
});
