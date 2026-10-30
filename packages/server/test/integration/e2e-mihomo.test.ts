// 端到端：订阅服务真实运行 → mihomo 客户端用订阅地址加载配置、从服务下载 provider → 流量经过代理链。
// 会在本机回环地址上起多个进程与端口，因此需要 MIHOMO 与 MIHOMO_RUNTIME=1，建议在 Docker 验证镜像中运行：
//   docker run --rm --network none sub-forge-test
//
// 拓扑：本地 HTTP 目标 ← "落地" socks5 ← "前置" socks5 ← 客户端 mihomo
//       "前置"节点来自远程订阅（本机临时"机场"），"落地"节点是本地节点组。

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve, type ServerType } from '@hono/node-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import type { ProfileDoc, Seed } from '../../src/docs.ts';
import { parseAllowList } from '../../src/net/ssrf.ts';
import { createUpstreamFetcher } from '../../src/net/upstream.ts';
import { RenderService } from '../../src/render.ts';
import { SnapshotService } from '../../src/snapshots.ts';
import { Store } from '../../src/store.ts';

const MIHOMO = process.env.MIHOMO;
const RUNTIME = process.env.MIHOMO_RUNTIME === '1';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address() as AddressInfo; s.close(() => resolve(port)); });
  });
}

function httpGet(url: string, opts: { proxyPort?: number; ua?: string } = {}): Promise<{ status: number | string; body: string }> {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = http.request(opts.proxyPort
      ? { host: '127.0.0.1', port: opts.proxyPort, path: url, headers: { Host: u.host }, timeout: 5000 }
      : { host: u.hostname, port: u.port, path: u.pathname + u.search, headers: { 'user-agent': opts.ua ?? 'test' }, timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (d) => { body += String(d); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 'timeout', body: '' }); });
    req.on('error', (e) => resolve({ status: e.message, body: '' }));
    req.end();
  });
}

type Instance = { proc: ChildProcess; log: () => string };

describe.skipIf(!MIHOMO || !RUNTIME)('端到端：订阅服务 → mihomo 客户端', () => {
  const procs: ChildProcess[] = [];
  const dirs: string[] = [];
  const servers: http.Server[] = [];
  let api: ServerType;
  let store: Store;
  let snapshots: SnapshotService;
  let entry: Instance;
  let exit: Instance;
  let ports: Record<'entry' | 'exit' | 'target' | 'airport' | 'api', number>;
  let targetHits = 0;
  const served: string[] = [];

  const startMihomo = (config: string): Instance => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-e2e-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'config.yaml'), config);
    let out = '';
    const proc = spawn(MIHOMO!, ['-d', dir, '-f', join(dir, 'config.yaml')], { stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout!.on('data', (d) => { out += String(d); });
    proc.stderr!.on('data', (d) => { out += String(d); });
    procs.push(proc);
    return { proc, log: () => out };
  };
  const socks = (port: number) => `log-level: debug\nipv6: false\ngeodata-mode: false\ngeo-auto-update: false\nlisteners:\n  - { name: in, type: socks, listen: 127.0.0.1, port: ${port}, udp: false }\nrules:\n  - MATCH,DIRECT\n`;

  const profile = (id: string, landing: 'provider' | 'inline', chainFilter?: string): ProfileDoc => ({
    id, name: `E2E ${landing}`,
    template: { id: 'tpl', follow: 'latest' },
    nodeSets: [{ ref: { type: 'source', id: 'airport' }, output: 'provider' }, { ref: { type: 'local', id: 'land' }, output: landing }],
    overlay: { groupPatches: { land: { addMembers: [{ kind: 'nodeset', ref: { type: 'local', id: 'land' } }] } } },
    chains: [{ id: 'c', landing: { nodeSet: { type: 'local', id: 'land' }, ...(chainFilter ? { filter: chainFilter } : {}) }, via: { kind: 'node', ref: { nodeSet: { type: 'source', id: 'airport' }, match: { exact: '🇭🇰 香港 前置' } } } }],
    refPolicy: { default: 'wrap' },
  });

  beforeAll(async () => {
    ports = { entry: await freePort(), exit: await freePort(), target: await freePort(), airport: await freePort(), api: await freePort() };
    const target = http.createServer((_q, r) => { targetHits++; r.end('ok'); });
    // 临时"机场"：远程订阅里的节点名需要经过处理链改名，验证处理链在真实拉取后生效
    const airport = http.createServer((_q, r) => {
      r.setHeader('subscription-userinfo', 'upload=10; download=20; total=1000; expire=1900000000');
      r.end(`proxies:\n  - { name: "香港 前置", type: socks5, server: 127.0.0.1, port: ${ports.entry} }\n  - { name: "剩余流量：10G", type: socks5, server: 127.0.0.1, port: 1 }\n`);
    });
    for (const [s, p] of [[target, ports.target], [airport, ports.airport]] as const) {
      await new Promise<void>((r) => s.listen(p, '127.0.0.1', r));
      servers.push(s);
    }

    store = new Store(':memory:');
    const user = store.createUser({ username: 'e2e-user', passwordHash: 'fixture', role: 'user' });
    const seed: Seed = {
      sources: [
        { id: 'airport', name: '机场', url: `http://localhost:${ports.airport}/sub`, pipeline: [{ op: 'filter.useless' }, { op: 'flag', mode: 'add' }] },
      ],
      locals: [{ id: 'land', name: '落地源', proxies: [{ name: '落地', type: 'socks5', server: '127.0.0.1', port: ports.exit }] }],
      templates: [{ id: 'tpl', version: 1, groups: [{ id: 'land', name: '落地组', type: 'select', members: [] }], rules: [], final: { kind: 'group', groupId: 'land' } }],
      profiles: [profile('p-provider', 'provider', '^落地$'), profile('p-inline', 'inline')],
      tokens: [{ token: 'tk-user', userId: user.id }],
    };
    store.importSeed(seed, user.id);
    // 机场在本机，用 localhost 验证生产路径上允许域名解析到回环地址。
    snapshots = new SnapshotService(store, createUpstreamFetcher({ allow: parseAllowList([]) }));
    const renderer = new RenderService(store, snapshots, { publicUrl: `http://127.0.0.1:${ports.api}` });
    const app = createApp({ store, renderer, snapshots });
    api = serve({ fetch: (req) => { served.push(new URL(req.url).pathname); return app.fetch(req); }, hostname: '127.0.0.1', port: ports.api });

    entry = startMihomo(socks(ports.entry));
    exit = startMihomo(socks(ports.exit));
    await sleep(800);
  }, 30000);

  afterAll(async () => {
    for (const p of procs) p.kill();
    await snapshots.settled();
    await new Promise((r) => api.close(r));
    for (const s of servers) await new Promise((r) => s.close(r));
    store.close();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it.each([
    ['落地在 provider（前置注入到本服务下发的 provider 内容）', 'p-provider'],
    ['落地内联', 'p-inline'],
  ])('%s', async (_title, profileId) => {
    const sub = await httpGet(`http://127.0.0.1:${ports.api}/sub/tk-user/${profileId}`, { ua: 'clash.meta' });
    expect(sub.status, sub.body).toBe(200);

    const mixed = await freePort();
    const ctl = await freePort();
    const config = `mixed-port: ${mixed}\nexternal-controller: 127.0.0.1:${ctl}\nlog-level: debug\nipv6: false\ngeodata-mode: false\ngeo-auto-update: false\n${sub.body}`;
    const dir = mkdtempSync(join(tmpdir(), 'sf-e2e-client-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'config.yaml'), config);
    const check = spawnSync(MIHOMO!, ['-t', '-d', dir, '-f', join(dir, 'config.yaml')], { encoding: 'utf8' });
    expect(check.status, check.stdout + check.stderr).toBe(0);

    const before = served.length;
    const e0 = entry.log().length;
    const x0 = exit.log().length;
    const hits = targetHits;
    const client = startMihomo(config);
    try {
      for (let i = 0; i < 50 && (await httpGet(`http://127.0.0.1:${ctl}/version`)).status !== 200; i++) await sleep(100);
      // provider 异步加载，给几次机会
      let res = await httpGet(`http://127.0.0.1:${ports.target}/`, { proxyPort: mixed });
      for (let i = 0; i < 10 && res.status !== 200; i++) { await sleep(300); res = await httpGet(`http://127.0.0.1:${ports.target}/`, { proxyPort: mixed }); }
      expect(res.status, `${client.log()}\n---- config ----\n${config}`).toBe(200);
      await sleep(300);
    } finally {
      client.proc.kill();
    }
    expect(targetHits).toBeGreaterThan(hits);
    expect(entry.log().slice(e0)).toContain(`127.0.0.1:${ports.exit}`);
    expect(exit.log().slice(x0)).toContain(`127.0.0.1:${ports.target}`);
    // 客户端从本服务下载了 provider
    expect(served.slice(before).some((p) => p.startsWith(`/p/tk-user/${profileId}/`))).toBe(true);
  }, 60000);

  it('订阅响应头带上游流量信息，访问日志记录识别结果', async () => {
    const res = await new Promise<http.IncomingMessage>((resolve) => http.get(`http://127.0.0.1:${ports.api}/sub/tk-user/p-inline`, { headers: { 'user-agent': 'FlClash/v0.8.80 clash-verge Platform/android' } }, resolve));
    res.resume();
    expect(res.headers['subscription-userinfo']).toBe('upload=10; download=20; total=1000; expire=1900000000');
    expect(store.recentAccess('p-inline')[0]).toMatchObject({ client: 'mihomo', platform: 'android', status: 200 });
  });
});
