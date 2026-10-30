import { stringify as testYaml } from 'yaml';
// 仅访问本机的真实内核验收；每项等待子进程退出并清理临时目录和 HTTP 服务。
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { renderMihomo } from '../../src/render/mihomo.ts';
import type { GroupSpec } from '../../src/types.ts';

const MIHOMO = process.env.MIHOMO;
async function port(): Promise<number> {
  const server = createTcpServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无法分配本地端口');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}
async function stop(process: ChildProcess) {
  if (process.exitCode !== null || process.signalCode !== null) return;
  const exited = once(process, 'exit');
  process.kill('SIGTERM');
  await exited;
}
async function close(server: Server) {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

describe.skipIf(!MIHOMO || process.env.MIHOMO_RUNTIME !== '1')('真实 Mihomo 空组默认拒绝', () => {
  const scenarios = (['select', 'url-test', 'fallback', 'load-balance'] as const).flatMap(type =>
    (['筛空', '排除协议', '静态空组', '节点失效'] as const).map(mode => [type, mode] as const));
  it.each(scenarios)('%s：%s 时不会直连，只有没有成员才回退 REJECT', async (type, mode) => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-empty-group-'));
    let child: ChildProcess | undefined;
    let hits = 0;
    const target = createServer((_request, response) => { hits++; response.end('不能直连'); });
    target.listen(0, '127.0.0.1');
    await once(target, 'listening');
    try {
      const mixed = await port(), control = await port();
      const group: GroupSpec = { id: 'g', name: '空组测试', type, whenEmpty: 'direct', filter: mode === '筛空' ? '^不存在$' : undefined, excludeType: mode === '排除协议' ? 'http|ss' : undefined, extra: { 'empty-fallback': 'DIRECT' }, members: mode === '静态空组' ? [] : [{ kind: 'nodeset', ref: { type: 'source', id: 's' } }], test: { url: 'http://127.0.0.1:9/', interval: 0 } };
      const rendered = renderMihomo({
        profile: { id: 'p', name: '测试', nodeSets: [{ ref: { type: 'source', id: 's' }, output: 'provider' }], overlay: { extraGroups: [{ group }], final: { kind: 'group', groupId: 'g' } }, chains: [], refPolicy: { default: 'wrap' } },
        nodeSets: { sources: { s: { id: 's', name: '本机测试源', url: 'http://127.0.0.1:9/sub', pipeline: [] } }, collections: {}, locals: {}, snapshots: { s: ['proxies:\n- {name: 原有节点, type: http, server: 127.0.0.1, port: 9}'] } },
        rules: { rulesets: {}, snapshots: {} }, urls: { provider: () => 'http://127.0.0.1:9/provider', ruleset: () => 'http://127.0.0.1:9/rules' },
        base: testYaml({ 'mixed-port': mixed, 'external-controller': `127.0.0.1:${control}`, 'log-level': 'warning', 'geo-auto-update': false, 'geodata-mode': false, ipv6: false }),
      });
      const provider = Object.values(rendered.providers)[0];
      if (provider) writeFileSync(join(dir, 'provider.yaml'), provider.yaml);
      // provider 的输出名称来自最终配置，而不是内部节点集 ID。
      const providerNames = Object.keys(rendered.config['proxy-providers'] ?? {});
      const fileProviders = Object.fromEntries(providerNames.map(name => [name, { type: 'file', path: join(dir, 'provider.yaml') }]));
      const config = { ...rendered.config, 'proxy-providers': fileProviders };
      writeFileSync(join(dir, 'config.yaml'), stringify(config));
      let logs = '';
      child = spawn(MIHOMO!, ['-d', dir, '-f', join(dir, 'config.yaml')], { stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout!.on('data', data => { logs += String(data); });
      child.stderr!.on('data', data => { logs += String(data); });
      let state: { all?: string[] } | undefined;
      for (let i = 0; i < 60; i++) {
        const response = await fetch(`http://127.0.0.1:${control}/proxies/${encodeURIComponent(group.name)}`).catch(error => {
          if (error instanceof TypeError && 'cause' in error && (error.cause as { code?: string })?.code === 'ECONNREFUSED') return undefined;
          throw error;
        });
        if (response?.ok) { state = await response.json() as { all?: string[] }; break; }
        if (child.exitCode !== null) throw new Error(`内核提前退出：${logs}`);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      expect(state?.all, logs).toEqual(mode === '节点失效' ? ['原有节点'] : ['REJECT']);
      // 失效节点仍在列表中，证明空组回退不等同于健康检查失败。
      if (mode === '节点失效') return;
      const address = target.address();
      if (!address || typeof address === 'string') throw new Error('目标服务不可用');
      const status = await new Promise<number>((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port: mixed, path: `http://127.0.0.1:${address.port}/`, timeout: 3000 }, response => { response.resume(); resolve(response.statusCode ?? 0); });
        req.on('error', reject); req.on('timeout', () => req.destroy(new Error('代理请求超时'))); req.end();
      });
      expect(status).toBe(502);
      expect(hits).toBe(0);
    } finally {
      if (child) await stop(child);
      await close(target);
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);
});
