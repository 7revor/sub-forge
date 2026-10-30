import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Store } from '../src/store.ts';
import { Cipher, hashPassword } from '../src/crypto.ts';
import { RuleRepoService } from '../src/rule-repos/service.ts';

it('CLI 收到退出信号后取消进行中的探测并等待子进程退出', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sf-shutdown-'));
  const db = join(root, 'test.db');
  const store = new Store(db, { cipher: new Cipher(Buffer.from('11'.repeat(32), 'hex')) });
  // 使用独立数据库，禁用所有仓库，整个测试不访问外网。
  new RuleRepoService(store, async () => { throw new Error('测试禁止上游请求'); });
  store.db.exec('UPDATE rule_repos SET enabled = 0');
  store.createUser({ username: 'qa', passwordHash: await hashPassword('qa-password'), role: 'admin' });
  store.close();
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'serve'], {
    env: { ...process.env, TMPDIR: root, SUBFORGE_DB: db, PORT: '0', HOST: '127.0.0.1', PUBLIC_URL: 'http://127.0.0.1', MIHOMO_BIN: resolve('test/fixtures/probe-kernel.cjs'), SUBFORGE_SECRET: Buffer.from('11'.repeat(32), 'hex').toString('base64') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += String(chunk); });
  child.stderr.on('data', chunk => { output += String(chunk); });
  const exited = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  let pending: Promise<unknown> | undefined;
  const waitUntil = async (check: () => Promise<boolean>) => {
    const end = Date.now() + 6000;
    while (!await check()) { if (Date.now() > end) throw new Error(`等待超时：${output}`); await sleep(50); }
  };
  const pids = async () => {
    try { return (await readFile(join(root, 'pids'), 'utf8')).trim().split('\n').filter(Boolean).map(Number); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  };
  try {
    await waitUntil(async () => /已启动：http:\/\/127\.0\.0\.1:\d+/.test(output));
    const origin = /已启动：(http:\/\/127\.0\.0\.1:\d+)/.exec(output)![1]!;
    const login = await fetch(`${origin}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'qa', password: 'qa-password' }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    await login.text();
    pending = fetch(`${origin}/api/node-probe`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ requestId: 'shutdown-probe-12345', node: { name: '退出测试', type: 'http', server: 'hang.example', port: 443 } }),
    }).then(res => res.json());
    await waitUntil(async () => (await pids()).length > 0);
    child.kill('SIGTERM');
    expect(await pending).toMatchObject({ status: 'cancelled' });
    expect(await exited).toBe(0);
    expect(output).not.toMatch(/unhandled|关闭服务失败/i);
    for (const pid of await pids()) expect(() => process.kill(pid, 0)).toThrow();
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
    // 仅在断言失败时兜底回收本测试生成的进程。
    for (const pid of await pids()) {
      try { process.kill(pid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    }
    if (pending) await Promise.allSettled([pending]);
    await rm(root, { recursive: true, force: true });
  }
}, 12000);
