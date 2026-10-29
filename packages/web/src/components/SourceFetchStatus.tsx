import type { sourceFetchSummary } from '../domain/sourceFetch.ts';
import { Badge } from './ui.tsx';

export function SourceFetchStatus({ state }: { state: Pick<ReturnType<typeof sourceFetchSummary>, 'lastOk' | 'failing'> }) {
  if (state.failing) return <Badge tone="err">{state.lastOk ? '拉取失败 · 使用快照' : '拉取失败'}</Badge>;
  return state.lastOk ? <Badge tone="ok">正常</Badge> : <Badge>未拉取</Badge>;
}
