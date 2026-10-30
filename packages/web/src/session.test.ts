import { QueryClient, isCancelledError } from '@tanstack/react-query';
import { expect, it } from 'vitest';
import { setSession } from './session.ts';

it('登录和会话失效清除前一用户的令牌，晚到的链接查询不能污染新账户', async () => {
  const client = new QueryClient();
  const key = ['resource-link', 'rulesets', 'public'];
  client.setQueryData(['user-token'], '旧账户令牌');
  client.setQueryData(['subscription-link', 'profile'], '旧配置链接');
  let release!: (value: string) => void;
  const oldRequest = client.fetchQuery({ queryKey: key, queryFn: () => new Promise<string>(resolve => { release = resolve; }) }).catch(error => error);
  setSession(client, null);
  expect(client.getQueryData(['user-token'])).toBeUndefined();
  expect(client.getQueryData(['subscription-link', 'profile'])).toBeUndefined();
  expect(client.getQueryData(['me'])).toBeNull();
  client.setQueryData(['resource-link', 'rulesets', 'stale'], '登录前旧缓存');
  setSession(client, { id: 'new', username: '新用户', role: 'user', disabled: false, scriptAllowed: false, createdAt: 0 });
  expect(client.getQueryData(['resource-link', 'rulesets', 'stale'])).toBeUndefined();
  client.setQueryData(key, '新账户链接');
  release('旧账户链接');
  expect(isCancelledError(await oldRequest)).toBe(true);
  expect(client.getQueryData(key)).toBe('新账户链接');
  client.clear();
});
