import type { RepoScan } from '../api.ts';

// 筛选与兼容配置由系统维护，表单只编辑分支和目录。
type RepoFileFilter = Omit<RepoScan, 'ref' | 'directory'>;
export type RepoLocation = { id: number; ref: string; directory: string; filters: RepoFileFilter[] };
export const blankRepoLocation = (id: number): RepoLocation => ({ id, ref: '', directory: '', filters: [{
  include: ['**/*.list', '**/*.txt'], exclude: [], format: 'auto', client: 'any', groupBy: 'path', readme: false, preferred: [],
}] });

/** 仅合并相邻的同分支、同目录配置，保持重叠范围的匹配优先级。 */
export function groupRepoLocations(scans: RepoScan[]): RepoLocation[] {
  const locations: RepoLocation[] = [];
  for (const { ref, directory, ...filter } of scans) {
    let location = locations.at(-1);
    if (!location || location.ref !== ref || location.directory !== directory) {
      location = { id: locations.length, ref, directory, filters: [] };
      locations.push(location);
    }
    location.filters.push(filter);
  }
  return locations;
}

export function serializeRepoLocations(locations: RepoLocation[]): RepoScan[] {
  return locations.flatMap(({ ref, directory, filters }) => filters.map(filter => ({ ...filter, ref, directory })));
}
