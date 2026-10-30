import type { QueryClient } from '@tanstack/react-query';
import type { User } from './api.ts';

/** 身份切换和会话失效时丢弃前一账户的文档、下载令牌及在途查询。 */
export function setSession(client: QueryClient, user: User | null): void {
  client.clear();
  client.setQueryData(['me'], user);
}
