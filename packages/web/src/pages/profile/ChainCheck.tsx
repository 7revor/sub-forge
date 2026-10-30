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
  return <div aria-label="代理链检查结果" aria-live="polite" className="border-t border-line-2 pt-2 text-[12.5px] leading-relaxed [overflow-wrap:anywhere]">
    {checking ? <span className="text-ink-muted">正在检查当前代理链…</span> : result ? <>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-ink-2">
        {result.viaName && <span>{chain.via.kind === 'group' ? '前置策略组' : '实际前置'}：<strong>{result.viaName}</strong></span>}
        <span>命中 {result.landingCount} 个落地节点{result.appliedCount !== result.landingCount && (result.appliedCount ? `，此规则应用于 ${result.appliedCount} 个` : '，前置未应用')}</span>
      </div>
      {issues.map((issue, i) => <p key={i} className={`mt-1 mb-0 ${issue.level === 'error' ? 'text-err' : 'text-warn'}`}>{label(issue.message)}{issue.code === 'chain.cycle' && cycles.length > 1 && `（另有 ${cycles.length - 1} 处循环，详见配置预览）`}</p>)}
    </> : <span className="text-ink-muted">暂未取得检查结果，请重新检查。</span>}
  </div>;
}
