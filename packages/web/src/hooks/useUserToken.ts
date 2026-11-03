import { useQuery } from '@tanstack/react-query';
import { api } from '../api.ts';

/** 账户页重置令牌时写入同一缓存，已打开页面的链接随之更新。 */
export function useUserToken(enabled = true) {
  return useQuery({ queryKey: ['user-token'], enabled, queryFn: () => api<{ item: { token: string } }>('GET', '/me/token').then(r => r.item.token) });
}
