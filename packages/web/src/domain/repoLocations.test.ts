import { describe, expect, it } from 'vitest';
import type { RepoScan } from '../api.ts';
import { blankRepoLocation, groupRepoLocations, serializeRepoLocations } from './repoLocations.ts';

const scan = (overrides: Partial<RepoScan> = {}): RepoScan => ({ ref: 'main', directory: '', include: ['**/*.list', '**/*.txt'], exclude: [], format: 'auto', client: 'any', groupBy: 'path', readme: false, preferred: [], ...overrides });

describe('仓库位置简化编辑', () => {
  it('同目录三类配置合并展示，往返保留所有隐藏配置和优先级', () => {
    const scans = ['rule/Clash', 'rule/Surge'].flatMap(directory => [
      scan({ directory, include: ['**/*_Domain.list'], format: 'domain', client: 'mihomo' }),
      scan({ directory, include: ['**/*_IP.list'], format: 'ipcidr', groupBy: 'directory' }),
      scan({ directory, exclude: ['**/*_Domain.list', '**/*_IP.list'], format: 'classical', readme: true, preferred: ['*_All.list'] }),
    ]);
    const locations = groupRepoLocations(scans);
    expect(locations.map(l => l.filters.length)).toEqual([3, 3]);
    expect(serializeRepoLocations(locations)).toEqual(scans);
    locations[0]!.ref = 'next'; locations[0]!.directory = 'nested/rules';
    expect(serializeRepoLocations(locations)).toEqual(scans.map((s, i) => i < 3 ? { ...s, ref: 'next', directory: 'nested/rules' } : s));
  });
  it('不同分支独立展示，不合并被其他范围隔开的配置', () => {
    const scans = [scan(), scan({ directory: 'nested' }), scan(), scan({ ref: 'release' })];
    expect(groupRepoLocations(scans)).toHaveLength(4);
    expect(serializeRepoLocations(groupRepoLocations(scans))).toEqual(scans);
  });
  it('新增只需地址，默认递归扫描两种文本文件并自动识别', () => {
    expect(serializeRepoLocations([blankRepoLocation(0)])).toEqual([scan({ ref: '' })]);
  });
});
