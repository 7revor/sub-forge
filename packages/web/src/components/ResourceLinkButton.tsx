import { useQuery } from '@tanstack/react-query';
import { Link2 } from 'lucide-react';
import { api } from '../api.ts';
import { CopyButton } from './CopyButton.tsx';

export type LinkKind = 'sources' | 'collections' | 'locals' | 'profiles' | 'rulesets';

/** 地址由服务端鉴权后返回，使用当前会话用户的凭证；未保存草稿不能复制。 */
export function ResourceLinkButton({ kind, id, name, disabled = false, size = 'md' }: { kind: LinkKind; id: string; name: string; disabled?: boolean; size?: 'sm' | 'md' }) {
  const link = useQuery({
    queryKey: ['resource-link', kind, id], enabled: !!id,
    queryFn: () => api<{ item: { url: string } }>('GET', `/resource-links/${kind}/${encodeURIComponent(id)}`).then(r => new URL(r.item.url, window.location.origin).href),
  });
  return <CopyButton size={size} text={link.data ?? ''} disabled={disabled || !link.data || link.isFetching || !!link.error}
    aria-label={`复制 ${name} 的链接`} title={disabled ? '请先保存修改' : link.error ? `链接读取失败：${link.error.message}` : '使用当前账户令牌复制托管链接'}>
    <Link2 size={14} />{link.error ? '链接不可用' : '复制链接'}
  </CopyButton>;
}
