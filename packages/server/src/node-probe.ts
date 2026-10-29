import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { stringify } from 'yaml';
import { TESTABLE_PROXY_TYPES, validateLocalProxy, type LocalProxy } from '@sub-forge/core';
import { assertUrlAllowed, parseAllowList, type AllowList } from './net/ssrf.ts';

export type ProbeResult = { ok: boolean; status: 'success' | 'failed' | 'unavailable' | 'cancelled'; message: string; delay?: number; testedAt: number; target: string };
export type NodeProbe = { available: () => Promise<boolean>; run: (node: LocalProxy, signal: AbortSignal) => Promise<ProbeResult>; close: () => Promise<void> };
const DEFAULT_TARGET = 'https://www.gstatic.com/generate_204';

/** 控制器只通过私有临时目录中的 Unix socket 访问，不开启代理入站或公共控制端口。 */
function controller(socketPath: string, path: string, signal: AbortSignal, timeout = 1500): Promise<{ status: number; data: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, path, signal, timeout }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { body += chunk; if (body.length > 65536) req.destroy(new Error('控制器响应过大')); });
      res.on('error', reject);
      res.on('end', () => {
        try { resolve({ status: res.statusCode ?? 500, data: JSON.parse(body) as Record<string, unknown> }); }
        catch { reject(new Error('控制器返回无效响应')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('控制器响应超时')));
    req.on('error', reject);
    req.end();
  });
}

/** 一次测试只允许一个节点。拒绝需要额外本地资源或其他出口的配置，不修改用户草稿。 */
export function checkProbeNode(node: LocalProxy, allow: AllowList): void {
  const issues = validateLocalProxy(node);
  if (issues.length) throw new Error(issues[0]!.message);
  if (!(TESTABLE_PROXY_TYPES as readonly string[]).includes(node.type)) throw new Error('此协议暂不支持服务端连通性测试');
  const host = node.server.includes(':') && !node.server.startsWith('[') ? `[${node.server}]` : node.server;
  const address = new URL(`http://${host}:${node.port}`);
  if (address.username || address.password || address.pathname !== '/' || address.search || address.hash) throw new Error('服务器地址格式不正确');
  assertUrlAllowed(address, allow);
  for (const key of ['interface-name', 'routing-mark', 'certificate', 'private-key', 'certificate-path', 'private-key-path']) {
    if (node[key] !== undefined) throw new Error(`服务端测试不支持 ${key}，请在实际客户端验证`);
  }
  if (node.plugin !== undefined && !['obfs', 'v2ray-plugin'].includes(String(node.plugin))) throw new Error('服务端测试不支持此插件');
}

function failureMessage(message: unknown): string {
  const text = String(message).toLowerCase();
  if (/timeout|deadline|超时/.test(text)) return '连接超时，请检查节点和服务端网络';
  if (/certificate|tls/.test(text)) return 'TLS 握手失败，请检查证书和服务器名称';
  if (/refused/.test(text)) return '连接被拒绝，请检查服务器和端口';
  if (/dns|lookup|resolve/.test(text)) return '域名解析失败，请检查服务器地址';
  if (/auth|password/.test(text)) return '认证失败，请检查节点凭据';
  return '代理请求失败，请检查节点配置、凭据和测试目标是否可达';
}

export function createNodeProbe(bin: string, options: { allow?: AllowList; target?: string; timeoutMs?: number; tempRoot?: string } = {}): NodeProbe {
  const target = options.target ?? DEFAULT_TARGET;
  const allow = options.allow ?? parseAllowList([]);
  const timeoutMs = options.timeoutMs ?? 10_000;
  const active = new Map<AbortController, Promise<ProbeResult>>();
  let closing = false;
  const available = async () => {
    if (closing || process.platform === 'win32') return false;
    try { await access(bin, constants.X_OK); return true; } catch { return false; }
  };
  async function execute(node: LocalProxy, abort: AbortController, parent: AbortSignal): Promise<ProbeResult> {
    let dir: string | undefined;
    let child: ChildProcess | undefined;
    let exited: Promise<void> | undefined;
    let processError = false;
    let didExit = false;
    const timer = setTimeout(() => abort.abort(), timeoutMs + 5000);
    const cancel = () => abort.abort();
    parent.addEventListener('abort', cancel, { once: true });
    if (parent.aborted) abort.abort();
    const result = (status: ProbeResult['status'], message: string, delay?: number): ProbeResult => ({ ok: status === 'success', status, message, ...(delay === undefined ? {} : { delay }), testedAt: Date.now(), target });
    try {
      checkProbeNode(node, allow);
      if (!await available()) return result('unavailable', '测试服务未配置或 Mihomo 不可执行');
      abort.signal.throwIfAborted();
      dir = await mkdtemp(join(options.tempRoot ?? tmpdir(), 'sf-probe-'));
      const socketPath = join(dir, 'api.sock');
      const config = join(dir, 'config.yaml');
      await writeFile(config, stringify({
        'external-controller-unix': socketPath, 'log-level': 'silent', mode: 'rule', ipv6: true,
        'geo-auto-update': false, 'find-process-mode': 'off', dns: { enable: false },
        proxies: [{ ...node, name: 'probe' }], rules: ['MATCH,REJECT'],
      }), { mode: 0o600 });
      abort.signal.throwIfAborted();
      // 不继承 SAFE_PATHS、代理或数据库密钥等环境变量。
      child = spawn(bin, ['-d', dir, '-f', config], { stdio: 'ignore', env: { PATH: process.env.PATH } });
      exited = new Promise(resolve => {
        child!.once('error', () => { processError = true; });
        child!.once('close', () => { didExit = true; resolve(); });
      });
      const readyUntil = Date.now() + 4000;
      while (true) {
        abort.signal.throwIfAborted();
        if (didExit || processError) return result('failed', 'Mihomo 无法加载此节点，请检查协议配置');
        try {
          if ((await controller(socketPath, '/version', abort.signal)).status === 200) break;
        } catch (error) {
          if (abort.signal.aborted) throw error;
          if (Date.now() >= readyUntil) return result('unavailable', '测试内核未能及时启动');
          // 内核启动期间 socket 尚未就绪，只在有限启动窗口内重试。
        }
        await sleep(80, undefined, { signal: abort.signal });
      }
      const query = new URLSearchParams({ url: target, timeout: String(timeoutMs), expected: '200-299' });
      const response = await controller(socketPath, `/proxies/probe/delay?${query}`, abort.signal, timeoutMs + 1000);
      if (response.status === 200 && typeof response.data.delay === 'number' && Number.isFinite(response.data.delay) && response.data.delay >= 0) return result('success', '连接成功', response.data.delay);
      return result('failed', failureMessage(response.data.message));
    } catch (error) {
      if (parent.aborted || closing) return result('cancelled', '测试已取消');
      if (abort.signal.aborted) return result('failed', '测试超时');
      // 不返回内核原始输出，避免错误日志中的凭据泄漏。
      return result('failed', error instanceof Error && !child ? error.message : failureMessage(error));
    } finally {
      clearTimeout(timer);
      parent.removeEventListener('abort', cancel);
      if (child && exited && !didExit) {
        child.kill('SIGTERM');
        const kill = setTimeout(() => child!.kill('SIGKILL'), 500);
        await exited;
        clearTimeout(kill);
      }
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  }
  return {
    available,
    run(node, signal) {
      if (closing || active.size >= 2) return Promise.resolve({ ok: false, status: 'unavailable', message: '测试服务繁忙，请稍后重试', testedAt: Date.now(), target });
      const abort = new AbortController();
      const task = execute(node, abort, signal).finally(() => active.delete(abort));
      active.set(abort, task);
      return task;
    },
    async close() { closing = true; for (const abort of active.keys()) abort.abort(); await Promise.all(active.values()); },
  };
}
