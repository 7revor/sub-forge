// 断网 Docker 中用本地 HTTP/DNS 验证规则语义：不能只检查 YAML 字符串或 mihomo -t。
import { spawn, type ChildProcess } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderMihomo, type MihomoRenderResult } from '../../src/render/mihomo.ts';

const MIHOMO = process.env.MIHOMO;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function port() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const value = (server.address() as AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return value;
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill(); await exited;
}

describe.skipIf(!MIHOMO || process.env.MIHOMO_RUNTIME !== '1')('mihomo 规则选项运行时语义', () => {
  const dirs: string[] = [];
  const dns = createSocket('udp4');
  let dnsQueries = 0, targetHits = 0, served: MihomoRenderResult;
  let targetPort: number, filePort: number, dnsPort: number;
  const target = http.createServer((_req, res) => { targetHits++; res.end('ok'); });
  const files = http.createServer((req, res) => {
    const key = decodeURIComponent(new URL(req.url ?? '/', 'http://local').pathname.slice(1));
    const body = served?.rulesets[key]?.text;
    res.statusCode = body === undefined ? 404 : 200; res.end(body);
  });
  beforeAll(async () => {
    await new Promise<void>(r => target.listen(0, '127.0.0.2', r));
    await new Promise<void>(r => files.listen(0, '127.0.0.1', r));
    await new Promise<void>(r => dns.bind(0, '127.0.0.1', r));
    targetPort = (target.address() as AddressInfo).port;
    filePort = (files.address() as AddressInfo).port;
    dnsPort = dns.address().port;
    dns.on('message', (query, peer) => {
      dnsQueries++;
      let end = 12;
      while (query[end]) end += query[end]! + 1;
      end += 5;
      const answerA = query.readUInt16BE(end - 4) === 1;
      const header = Buffer.from(query.subarray(0, 12));
      header.writeUInt16BE(0x8180, 2); header.writeUInt16BE(1, 4);
      header.writeUInt16BE(answerA ? 1 : 0, 6); header.writeUInt32BE(0, 8);
      const answer = answerA ? Buffer.from('c00c000100010000000000047f000002', 'hex') : Buffer.alloc(0);
      dns.send(Buffer.concat([header, query.subarray(12, end), answer]), peer.port, peer.address);
    });
  });
  afterAll(async () => {
    await Promise.all([new Promise<void>(r => target.close(() => r())), new Promise<void>(r => files.close(() => r())), new Promise<void>(r => dns.close(r))]);
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  async function run(content: string, src: boolean, reject: boolean, hostname: string) {
    const mixed = await port(), ctl = await port();
    served = renderMihomo({
      profile: { id: 'p', name: 'P', nodeSets: [], chains: [], refPolicy: { default: 'wrap' }, overlay: { extraRules: [{ anchor: 'top', rule: { id: 'r', matcher: { kind: 'ruleset', id: 'rs' }, options: { src }, target: { kind: 'builtin', name: reject ? 'REJECT' : 'DIRECT' } } }], final: { kind: 'builtin', name: reject ? 'DIRECT' : 'REJECT' } } },
      nodeSets: { sources: {}, collections: {}, locals: {}, snapshots: {} },
      rules: { rulesets: { rs: { id: 'rs', name: 'R', kind: 'local', format: 'classical', content } }, bundles: {}, snapshots: {} },
      urls: { provider: key => `http://127.0.0.1:${filePort}/${key}`, ruleset: key => `http://127.0.0.1:${filePort}/${key}` },
      base: { 'mixed-port': mixed, 'external-controller': `127.0.0.1:${ctl}`, ipv6: false, 'log-level': 'warning', dns: { enable: true, ipv6: false, 'enhanced-mode': 'redir-host', nameserver: [`udp://127.0.0.1:${dnsPort}`] } },
    });
    const dir = mkdtempSync(join(tmpdir(), 'sf-rule-runtime-')); dirs.push(dir);
    writeFileSync(join(dir, 'config.yaml'), served.yaml);
    const child = spawn(MIHOMO!, ['-d', dir, '-f', join(dir, 'config.yaml')], { stdio: ['ignore', 'pipe', 'pipe'] });
    let logs = ''; child.stdout.on('data', data => { logs += data; }); child.stderr.on('data', data => { logs += data; });
    try {
      let ready = false;
      for (let i = 0; i < 60; i++) {
        try {
          const response = await fetch(`http://127.0.0.1:${ctl}/providers/rules`, { signal: AbortSignal.timeout(250) });
          const body = await response.json() as { providers: Record<string, { ruleCount: number }> };
          if (Object.values(body.providers).some(p => p.ruleCount > 0)) { ready = true; break; }
        } catch (error) { if (child.exitCode !== null) throw new Error(`内核退出：${logs}`, { cause: error }); }
        await sleep(80);
      }
      expect(ready, logs).toBe(true);
      const d0 = dnsQueries, t0 = targetHits;
      const status = await new Promise<number | string>(resolve => {
        const req = http.get({ host: '127.0.0.1', port: mixed, path: `http://${hostname}:${targetPort}/`, headers: { host: `${hostname}:${targetPort}` }, timeout: 2000 }, res => { res.resume(); resolve(res.statusCode ?? 0); });
        req.once('timeout', () => { req.destroy(); resolve('超时'); }); req.once('error', err => resolve(err.message));
      });
      return { status, queries: dnsQueries - d0, hits: targetHits - t0, logs };
    } finally { await stop(child); }
  }

  it.each([false, true])('规则集 no-resolve=%s 决定是否触发 DNS', async noResolve => {
    const r = await run(`IP-CIDR,127.0.0.2/32${noResolve ? ',no-resolve' : ''}`, false, false, 'audit.test');
    if (noResolve) { expect(r.status).not.toBe(200); expect(r.queries).toBe(0); expect(r.hits).toBe(0); }
    else { expect(r.status, r.logs).toBe(200); expect(r.queries).toBeGreaterThan(0); expect(r.hits).toBe(1); }
  }, 15000);

  it.each([false, true])('规则级 src=%s 决定匹配来源还是目标 IP', async src => {
    const r = await run('IP-CIDR,127.0.0.1/32', src, true, '127.0.0.2');
    if (src) { expect(r.status).not.toBe(200); expect(r.hits).toBe(0); }
    else { expect(r.status, r.logs).toBe(200); expect(r.hits).toBe(1); }
  }, 15000);
});
