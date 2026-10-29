import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo, Socket } from 'node:net';
import { createNodeProbe, type NodeProbe } from '../../src/node-probe.ts';
import { parseAllowList } from '../../src/net/ssrf.ts';

const bin = process.env.MIHOMO;
describe.skipIf(!bin)('真实 Mihomo 草稿连通性（仅本机受控代理）', () => {
  let target: http.Server;
  let proxy: http.Server;
  let probe: NodeProbe;
  let targetUrl: string;
  let proxyPort: number;
  let hits = 0;
  let tunnels = 0;
  const sockets = new Set<Socket>();
  beforeAll(async () => {
    target = http.createServer((_req, res) => { hits++; res.writeHead(204); res.end(); });
    proxy = http.createServer((_req, res) => { res.writeHead(405); res.end(); });
    const listen = async (server: http.Server) => {
      server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      return (server.address() as AddressInfo).port;
    };
    const targetPort = await listen(target);
    targetUrl = `http://127.0.0.1:${targetPort}/generate_204`;
    proxy.on('connect', (req, socket, head) => {
      tunnels++;
      if (req.headers['proxy-authorization'] !== `Basic ${Buffer.from('test:correct-password').toString('base64')}`) {
        socket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n'); return;
      }
      if (req.url !== `127.0.0.1:${targetPort}`) { socket.destroy(); return; }
      const upstream = net.connect(targetPort, '127.0.0.1', () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        socket.pipe(upstream); upstream.pipe(socket);
      });
      sockets.add(upstream);
      upstream.on('close', () => { sockets.delete(upstream); socket.destroy(); });
      upstream.on('error', () => socket.destroy());
      socket.on('error', () => upstream.destroy());
      socket.on('close', () => upstream.destroy());
    });
    proxyPort = await listen(proxy);
    probe = createNodeProbe(bin!, { target: targetUrl, allow: parseAllowList(['127.0.0.1']), timeoutMs: 2000 });
  });
  afterAll(async () => {
    await probe?.close();
    for (const socket of sockets) socket.destroy();
    await Promise.all([target, proxy].filter(Boolean).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  });
  it('通过指定代理完成 HTTP 请求，返回延迟', async () => {
    const result = await probe.run({ name: '未保存草稿', type: 'http', server: '127.0.0.1', port: proxyPort, username: 'test', password: 'correct-password' }, new AbortController().signal);
    expect(result).toMatchObject({ ok: true, status: 'success', delay: expect.any(Number), target: targetUrl });
    expect(tunnels).toBeGreaterThan(0); expect(hits).toBeGreaterThan(0);
  });
  it('端口开放但认证失败不能报成功，也不能直连回退', async () => {
    const before = hits;
    const result = await probe.run({ name: '错误凭据', type: 'http', server: '127.0.0.1', port: proxyPort, username: 'test', password: 'wrong-password' }, new AbortController().signal);
    expect(result.ok).toBe(false); expect(hits).toBe(before);
  });
});
