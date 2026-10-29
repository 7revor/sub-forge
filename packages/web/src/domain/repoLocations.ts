import type { RepoScan } from '../api.ts';

export type RepoFileFilter = Omit<RepoScan, 'ref' | 'directory' | 'include' | 'exclude' | 'preferred'> & {
  include: string; exclude: string; preferred: string;
};
export type RepoLocation = { id: number; ref: string; directory: string; filters: RepoFileFilter[] };
export const blankRepoFilter = (): RepoFileFilter => ({ include: '**/*.list\n**/*.txt', exclude: '', format: 'auto', client: 'any', groupBy: 'path', readme: false, preferred: '' });
export const blankRepoLocation = (id: number): RepoLocation => ({ id, ref: '', directory: '', filters: [blankRepoFilter()] });
export const patternLines = (text: string) => text.split('\n').map(s => s.trim()).filter(Boolean);

/** 仅合并相邻的同分支、同目录配置，保持重叠范围的匹配优先级。 */
export function groupRepoLocations(scans: RepoScan[]): RepoLocation[] {
  const locations: RepoLocation[] = [];
  for (const { ref, directory, include, exclude, preferred, ...rest } of scans) {
    let location = locations.at(-1);
    if (!location || location.ref !== ref || location.directory !== directory) {
      location = { id: locations.length, ref, directory, filters: [] };
      locations.push(location);
    }
    location.filters.push({ ...rest, include: include.join('\n'), exclude: exclude.join('\n'), preferred: preferred.join('\n') });
  }
  return locations;
}

export function serializeRepoLocations(locations: RepoLocation[]): RepoScan[] {
  return locations.flatMap(({ ref, directory, filters }) => filters.map(({ include, exclude, preferred, ...rest }) => ({
    ...rest, ref, directory, include: patternLines(include), exclude: patternLines(exclude), preferred: patternLines(preferred),
  })));
}
