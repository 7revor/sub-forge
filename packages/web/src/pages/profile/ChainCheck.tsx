import { useQuery } from '@tanstack/react-query';
import type { ChainResolution, ChainRule } from '@sub-forge/core';
import { api, type ProfilePreview } from '../../api.ts';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.ts';
import { useProfile } from './context.ts';
import { persistedProfile } from './routing.ts';

/** 每份草稿对应独立查询；改动后立即隐藏旧结果，防抖后检查当前配置。 */
export function useChainCheck() {
  const { draft, template } = useProfile();
  const snapshot = JSON.stringify({ profile: persistedProfile(draft), templateVersion: template?.version });
  const settled = useDebouncedValue(snapshot, 450);
  const query = useQuery({
    queryKey: ['profile-chain-check', settled], enabled: draft.chains.length > 0 && snapshot === settled,
    queryFn: () => {
      const { profile } = JSON.parse(settled);
      return api<ProfilePreview>('POST', profile.id ? `/profiles/${profile.id}/preview` : '/profiles/preview', { profile, client: 'mihomo' });
    },
    retry: false, refetchOnWindowFocus: false, staleTime: 0,
  });
  const current = snapshot === settled && !query.isFetching && !query.error;
  return { result: current ? query.data : undefined, checking: snapshot !== settled || query.isFetching || query.isPending, error: snapshot === settled ? query.error : undefined, refresh: () => void query.refetch() };
}

export function ChainCheckResult({ chain, result, checking }: { chain: ChainRule; result?: ChainResolution; checking: boolean }) {
  const { profileNodeSets } = useProfile();
  const cycles = result?.issues.filter(i => i.code === 'chain.cycle') ?? [];
  const issues = result?.issues.filter(i => i.code !== 'chain.cycle' || i === cycles[0]) ?? [];
  const label = (message: string) => profileNodeSets.reduce((text, s) => text.replaceAll(`${s.ref.type}:${s.ref.id}`, `「${s.name}」`), message);
  const actual = result?.viaName && chain.via.kind === 'node' && (!('exact' in chain.via.ref.match) || result.viaName !== chain.via.ref.match.exact) ? `命中 ${result.viaName} · ` : '';
  const summary = checking ? '检查中…' : result ? `${actual}落地 ${result.landingCount} 个${result.appliedCount !== result.landingCount ? result.appliedCount ? `，应用 ${result.appliedCount} 个` : '，前置未应用' : ''}` : '暂无检查结果，请重新检查';
  const messages = issues.map(issue => `${label(issue.message)}${issue.code === 'chain.cycle' && cycles.length > 1 ? `（另有 ${cycles.length - 1} 处循环，详见配置预览）` : ''}`);
  return <span aria-label="代理链检查结果" aria-live="polite" title={[summary, ...messages].join('；')} className="min-w-0 max-w-full truncate text-[12px] leading-6 text-ink-muted">
    {summary}{issues.map((issue, i) => <span key={i} className={issue.level === 'error' ? 'text-err' : 'text-warn'}> · {messages[i]}</span>)}
  </span>;
}
