// 真实连接下的上游拉取：域名解析后的 IP 不拦截，字面 IP 与重定向 URL 仍检查。
// 只访问回环地址，不需要外网。

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseAllowList } from '../../src/net/ssrf.ts';
import { createUpstreamFetcher } from '../../src/net/upstream.ts';

let server: http.Server;
let port: number;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/sub') {
      res.setHeader('subscription-userinfo', 'upload=1; download=2; total=3');
      res.end(`ua=${req.headers['user-agent']}`);
    } else if (req.url === '/to-literal') {
      res.statusCode = 302; res.setHeader('location', `http://127.0.0.1:${port}/sub`); res.end();
    } else if (req.url === '/to-localhost') {
      res.statusCode = 302; res.setHeader('location', `http://localhost:${port}/sub`); res.end();
    } else if (req.url === '/hang') {
      // 不响应，等待客户端超时
    } else {
      res.statusCode = 404; res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

describe('真实连接下的上游拉取', () => {
  it('域名解析到回环地址仍正常拉取，无需白名单', async () => {
    const f = createUpstreamFetcher({ allow: parseAllowList([]) });
    expect(await f(`http://localhost:${port}/sub`)).toMatchObject({ status: 200, body: 'ua=clash.meta' });
  });

  it('默认禁止访问本机：字面 IP 在发请求前被拦截', async () => {
    const f = createUpstreamFetcher({ allow: parseAllowList([]) });
    await expect(f(`http://127.0.0.1:${port}/sub`)).rejects.toThrow(/禁止访问内网或保留 IP 地址 127\.0\.0\.1/);
  });

  it('白名单放行字面 IP 后正常拉取，带 UA 与流量信息', async () => {
    const f = createUpstreamFetcher({ allow: parseAllowList(['127.0.0.1']) });
    expect(await f(`http://127.0.0.1:${port}/sub`, { ua: 'FlClash' })).toEqual({ status: 200, body: 'ua=FlClash', userinfo: { upload: 1, download: 2, total: 3 } });
  });

  it('域名重定向到未放行的字面 IP 仍被拦截', async () => {
    const f = createUpstreamFetcher({ allow: parseAllowList([]) });
    await expect(f(`http://localhost:${port}/to-literal`)).rejects.toThrow(/禁止访问内网或保留 IP 地址 127\.0\.0\.1/);
  });

  it('重定向到域名不检查 DNS 结果', async () => {
    const g = createUpstreamFetcher({ allow: parseAllowList(['127.0.0.1']) });
    expect(await g(`http://127.0.0.1:${port}/to-localhost`)).toMatchObject({ status: 200, body: 'ua=clash.meta' });
  });

  it('超时与非 2xx', async () => {
    const f = createUpstreamFetcher({ allow: parseAllowList(['127.0.0.1']) });
    await expect(f(`http://127.0.0.1:${port}/hang`, { timeoutMs: 300 })).rejects.toThrow(/超时|timeout|aborted/i);
    await expect(f(`http://127.0.0.1:${port}/missing`)).rejects.toThrow('HTTP 404');
  });
});
