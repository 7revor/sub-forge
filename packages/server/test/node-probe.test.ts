import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { checkProbeNode, createNodeProbe, type NodeProbe } from '../src/node-probe.ts';
import { parseAllowList } from '../src/net/ssrf.ts';

const node = { name: '含凭据的草稿', type: 'http', server: 'success.example', port: 443, password: 'secret-password' };
const fixture = resolve('test/fixtures/probe-kernel.cjs');
const roots: string[] = [];
const probes: NodeProbe[] = [];
async function setup(timeoutMs = 1000) {
  const root = await mkdtemp(join(tmpdir(), 'sf-probe-test-'));
  roots.push(root);
  const probe = createNodeProbe(fixture, { tempRoot: root, timeoutMs });
  probes.push(probe);
  return { root, probe };
}
afterEach(async () => {
  for (const probe of probes.splice(0)) await probe.close();
  for (const root of roots.splice(0)) {
    expect((await readdir(root)).filter(x => x.startsWith('sf-probe-'))).toEqual([]);
    const pids = await readFile(join(root, 'pids'), 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
    for (const pid of pids.trim().split('\n').filter(Boolean).map(Number)) expect(() => process.kill(pid, 0)).toThrow();
    await rm(root, { recursive: true, force: true });
  }
});

describe('节点探测进程生命周期', () => {
  it('缺失内核返回不可用，不误报节点失败', async () => {
    const probe = createNodeProbe('/not-installed/mihomo');
    expect(await probe.available()).toBe(false);
    expect(await probe.run(node, new AbortController().signal)).toMatchObject({ ok: false, status: 'unavailable' });
  });
  it('读取真实控制器响应，结束后清理进程及目录', async () => {
    const { probe } = await setup();
    expect(await probe.run(node, new AbortController().signal)).toMatchObject({ ok: true, delay: 42 });
  });
  it('失败消息分类且不泄露凭据', async () => {
    const { probe } = await setup();
    const result = await probe.run({ ...node, server: 'fail.example' }, new AbortController().signal);
    expect(result).toMatchObject({ ok: false, message: '认证失败，请检查节点凭据' });
    expect(JSON.stringify(result)).not.toContain(node.password);
  });
  it('启动异常不挂起', async () => {
    const { probe } = await setup();
    expect(await probe.run({ ...node, server: 'exit.example' }, new AbortController().signal)).toMatchObject({ ok: false, status: 'failed' });
  });
  it('控制器无响应超时后也强制回收进程', async () => {
    const { probe } = await setup(100);
    expect(await probe.run({ ...node, server: 'hang.example' }, new AbortController().signal)).toMatchObject({ ok: false, message: expect.stringContaining('超时') });
  });
  it('取消和服务关闭都等待清理，最多两个并发', async () => {
    const { probe } = await setup();
    const abort = new AbortController();
    const a = probe.run({ ...node, server: 'hang.example' }, abort.signal);
    const b = probe.run({ ...node, server: 'hang.example' }, new AbortController().signal);
    expect(await probe.run(node, new AbortController().signal)).toMatchObject({ status: 'unavailable' });
    await sleep(200);
    abort.abort();
    expect(await a).toMatchObject({ status: 'cancelled' });
    await probe.close();
    expect(await b).toMatchObject({ status: 'cancelled' });
  });
  it('控制器持续返回非成功状态时按启动期限结束并清理', async () => {
    const { probe } = await setup();
    expect(await probe.run({ ...node, server: 'notready.example' }, new AbortController().signal)).toMatchObject({ status: 'unavailable', message: '测试内核未能及时启动' });
  }, 9000);
  it('预先取消不启动进程', async () => {
    const { probe } = await setup();
    const abort = new AbortController(); abort.abort();
    expect(await probe.run(node, abort.signal)).toMatchObject({ status: 'cancelled' });
  });
});

describe('探测配置边界', () => {
  it('校验端口、协议、代理链、文件路径和内网地址', () => {
    for (const patch of [{ port: 1.5 }, { type: 'direct' }, { 'dialer-proxy': 'DIRECT' }, { 'private-key': '/secret' }, { server: '127.0.0.1' }, { server: 'user@public.example' }]) {
      expect(() => checkProbeNode({ ...node, ...patch }, parseAllowList([]))).toThrow();
    }
    expect(() => checkProbeNode({ ...node, server: '127.0.0.1' }, parseAllowList(['127.0.0.1']))).not.toThrow();
  });
});
