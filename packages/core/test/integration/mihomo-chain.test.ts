// 代理链集成测试（docs/06 §6）：用真实 mihomo 内核验证渲染结果。
// 需要环境变量 MIHOMO 指向 mihomo 二进制（v1.19.27+），否则整组跳过：
//   MIHOMO=/path/to/mihomo pnpm --filter @sub-forge/core test
//
// 拓扑：本地 HTTP 目标 ← "落地" socks5 实例 ← "前置" socks5 实例 ← 客户端 mihomo（加载渲染出的配置）。
// 判读：前置实例的日志里出现连向落地端口的连接，且落地实例的日志里出现连向目标的连接 ⇒ 链路生效。

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderMihomo, type MihomoRenderResult, type RenderInput } from '../../src/render/mihomo.ts';
import type { Profile, Template } from '../../src/types.ts';

const MIHOMO = process.env.MIHOMO;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function waitHttp(url: string, timeoutMs = 5000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const ok = await new Promise<boolean>((resolve) => {
      http.get(url, (res) => { res.resume(); resolve(true); }).on('error', () => resolve(false));
    });
    if (ok) return;
    await sleep(100);
  }
  throw new Error(`等待 ${url} 超时`);
}

/** 经 mixed-port（HTTP 代理）请求目标，返回状态码；连接被拒绝时返回错误信息 */
function viaProxy(proxyPort: number, target: string): Promise<number | string> {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: proxyPort, path: target, headers: { Host: new URL(target).host }, timeout: 5000 }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('timeout', () => { req.destroy(); resolve('timeout'); });
    req.on('error', (e) => resolve(e.message));
    req.end();
  });
}

type Instance = { proc: ChildProcess; log: () => string };

function startMihomo(dir: string, config: string): Instance {
  writeFileSync(join(dir, 'config.yaml'), config);
  let out = '';
  const proc = spawn(MIHOMO!, ['-d', dir, '-f', join(dir, 'config.yaml')], { stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout!.on('data', (d) => { out += String(d); });
  proc.stderr!.on('data', (d) => { out += String(d); });
  return { proc, log: () => out };
}

const socksInstance = (port: number) => `log-level: debug
ipv6: false
geodata-mode: false
geo-auto-update: false
listeners:
  - { name: in, type: socks, listen: 127.0.0.1, port: ${port}, udp: false }
rules:
  - MATCH,DIRECT
`;

describe.skipIf(!MIHOMO || process.env.MIHOMO_RUNTIME !== '1')('mihomo 代理链集成测试', () => {
  const procs: ChildProcess[] = [];
  const servers: http.Server[] = [];
  const dirs: string[] = [];
  let ports: { entry: number; exit: number; target: number; files: number };
  let entry: Instance;
  let exit: Instance;
  let targetHits = 0;
  /** 渲染结果的 provider / 规则集内容由这个服务按 URL 提供 */
  let served: MihomoRenderResult | undefined;

  beforeAll(async () => {
    ports = { entry: await freePort(), exit: await freePort(), target: await freePort(), files: await freePort() };
    const target = http.createServer((_req, res) => { targetHits++; res.end('ok'); });
    const files = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      const [, kind, , key] = url.pathname.split('/').map(decodeURIComponent);
      const body = kind === 'p' ? served?.providers[key!]?.yaml : kind === 'r' ? served?.rulesets[key!]?.text : undefined;
      if (body === undefined) { res.statusCode = 404; res.end(); return; }
      res.end(body);
    });
    for (const [srv, port] of [[target, ports.target], [files, ports.files]] as const) {
      await new Promise<void>((r) => srv.listen(port, '127.0.0.1', r));
      servers.push(srv);
    }
    for (const [name, port] of [['entry', ports.entry], ['exit', ports.exit]] as const) {
      const dir = mkdtempSync(join(tmpdir(), `sf-${name}-`));
      dirs.push(dir);
      const inst = startMihomo(dir, socksInstance(port));
      procs.push(inst.proc);
      if (name === 'entry') entry = inst; else exit = inst;
    }
    await sleep(800);
  }, 20000);

  afterAll(async () => {
    for (const p of procs) p.kill();
    for (const s of servers) await new Promise((r) => s.close(r));
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  const template: Template = {
    id: 't', version: 1,
    groups: [{ id: 'land', name: '落地组', type: 'select', members: [] }],
    rules: [],
    final: { kind: 'group', groupId: 'land' },
  };

  const renderScenario = (opts: { entryName: string; landingProvider: boolean; chainFilter?: string; viaGroup?: boolean; oldSelfDialer?: boolean }) => {
    const socks = (name: string, port: number) => `- { name: "${name}", type: socks5, server: 127.0.0.1, port: ${port} }`;
    const profile: Profile = {
      id: 'p', name: 'P',
      nodeSets: [
        { ref: { type: 'source', id: 'T' }, output: 'provider' },
        { ref: { type: 'source', id: 'L' }, output: opts.landingProvider ? 'provider' : 'inline' },
      ],
      overlay: { groupPatches: { land: { addMembers: [{ kind: 'nodeset', ref: { type: 'source', id: 'L' } }] } } },
      chains: [{ id: 'c', landing: { nodeSet: { type: 'source', id: 'L' }, ...(opts.chainFilter ? { filter: opts.chainFilter } : {}) }, via: { kind: 'node', ref: { nodeSet: { type: 'source', id: 'T' }, match: { exact: '前置' } } } }],
      refPolicy: { default: 'wrap' },
    };
    const input: RenderInput = {
      profile, template,
      nodeSets: {
        sources: {
          T: { id: 'T', name: '中转', kind: 'local', pipeline: [], content: `proxies:\n  ${socks(opts.entryName, ports.entry)}\n` },
          L: { id: 'L', name: '落地源', kind: 'local', pipeline: [], content: `proxies:\n  ${socks('落地', ports.exit)}\n` },
        },
        collections: {}, locals: {}, snapshots: {},
      },
      rules: { rulesets: {}, bundles: {}, snapshots: {} },
      urls: {
        provider: (key, v) => `http://127.0.0.1:${ports.files}/p/TOKEN/${encodeURIComponent(key)}?v=${v}`,
        ruleset: (key) => `http://127.0.0.1:${ports.files}/r/TOKEN/${key}`,
      },
      base: { 'log-level': 'debug', ipv6: false, 'geodata-mode': false, 'geo-auto-update': false },
    };
    if (opts.viaGroup) {
      profile.overlay.extraGroups = [{ group: { id: 'pre', name: '普通前置组', type: 'select', members: [{ kind: 'nodeset', ref: { type: 'source', id: 'T' } }], filter: '^前置$', whenEmpty: 'reject' } }];
      profile.chains[0]!.via = { kind: 'group', groupId: 'pre' };
    }
    if (opts.oldSelfDialer) input.nodeSets.sources.L!.content = input.nodeSets.sources.L!.content!.replace(`port: ${ports.exit}`, `port: ${ports.exit}, dialer-proxy: 落地组`);
    return renderMihomo(input);
  };

  async function runClient(result: MihomoRenderResult): Promise<{ status: number | string; entryLog: string; exitLog: string; clientLog: string; config: string }> {
    served = result;
    const mixed = await freePort();
    const ctl = await freePort();
    const dir = mkdtempSync(join(tmpdir(), 'sf-client-'));
    dirs.push(dir);
    const config = result.yaml.replace(/^/, `mixed-port: ${mixed}\nexternal-controller: 127.0.0.1:${ctl}\n`);
    writeFileSync(join(dir, 'config.yaml'), config);
    const check = spawnSync(MIHOMO!, ['-t', '-d', dir, '-f', join(dir, 'config.yaml')], { encoding: 'utf8' });
    expect(check.status, check.stdout + check.stderr).toBe(0);
    const e0 = entry.log().length;
    const x0 = exit.log().length;
    const client = startMihomo(dir, config);
    procs.push(client.proc);
    try {
      await waitHttp(`http://127.0.0.1:${ctl}/version`);
      await sleep(500);
      const status = await viaProxy(mixed, `http://127.0.0.1:${ports.target}/`);
      await sleep(300);
      return { status, entryLog: entry.log().slice(e0), exitLog: exit.log().slice(x0), clientLog: client.log(), config };
    } finally {
      client.proc.kill();
    }
  }

  it.each([
    ['落地在 provider、整源 override', true, undefined],
    ['落地在 provider、部分节点注入', true, '^落地$'],
    ['落地内联', false, undefined],
  ])('%s：流量经过前置', async (_title, landingProvider, chainFilter) => {
    const r = renderScenario({ entryName: '前置', landingProvider, ...(chainFilter ? { chainFilter } : {}) });
    expect(r.report.items.filter((i) => i.level === 'error')).toEqual([]);
    const hits = targetHits;
    const out = await runClient(r);
    expect(out.status, `${out.clientLog}\n---- config ----\n${out.config}`).toBe(200);
    expect(targetHits).toBe(hits + 1);
    expect(out.entryLog).toContain(`127.0.0.1:${ports.exit}`);
    expect(out.exitLog).toContain(`127.0.0.1:${ports.target}`);
  }, 30000);

  it('包装组筛空时连接被拒绝，而不是绕过前置直连', async () => {
    const r = renderScenario({ entryName: '前置', landingProvider: true });
    // 模拟 provider 中前置节点消失：把下发的中转 provider 内容换成别的节点名
    const t = r.providers['source:T']!;
    const broken = { ...r, providers: { ...r.providers, 'source:T': { ...t, yaml: t.yaml.replace('前置', '别的节点') } } };
    const hits = targetHits;
    const out = await runClient(broken);
    expect(out.status).not.toBe(200);
    expect(targetHits).toBe(hits);
    expect(out.exitLog).not.toContain(`127.0.0.1:${ports.target}`);
  }, 30000);

  it('普通前置组筛空后拒绝连接，provider 刷新也不能绕行', async () => {
    const r = renderScenario({ entryName: '前置', landingProvider: true, viaGroup: true });
    const healthy = await runClient(r);
    expect(healthy.status, healthy.clientLog).toBe(200);
    expect(healthy.entryLog).toContain(`127.0.0.1:${ports.exit}`);
    const t = r.providers['source:T']!;
    const hits = targetHits;
    const broken = await runClient({ ...r, providers: { ...r.providers, 'source:T': { ...t, yaml: t.yaml.replace('前置', '已经改名') } } });
    expect(broken.status).not.toBe(200);
    expect(targetHits).toBe(hits);
    expect(broken.exitLog).not.toContain(`127.0.0.1:${ports.target}`);
  }, 30000);

  it('整源 override 优先于节点原有前置，环检测与运行时一致', async () => {
    const r = renderScenario({ entryName: '前置', landingProvider: true, oldSelfDialer: true });
    expect(r.report.items.filter((item) => item.level === 'error')).toEqual([]);
    const out = await runClient(r);
    expect(out.status, out.clientLog).toBe(200);
    expect(out.entryLog).toContain(`127.0.0.1:${ports.exit}`);
  }, 30000);
});
