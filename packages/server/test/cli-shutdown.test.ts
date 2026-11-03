import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Store } from '../src/store.ts';
import { Cipher } from '../src/crypto.ts';
import { RuleRepoService } from '../src/rule-repos/service.ts';

it('CLI 收到退出信号后完成清理并正常退出', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sf-shutdown-'));
  const db = join(root, 'test.db');
  const store = new Store(db, { cipher: new Cipher(Buffer.from('11'.repeat(32), 'hex')) });
  // 使用独立数据库，禁用所有仓库，整个测试不访问外网。
  new RuleRepoService(store, async () => { throw new Error('测试禁止上游请求'); });
  store.db.exec('UPDATE rule_repos SET enabled = 0');
  store.close();
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'serve'], {
    env: { ...process.env, TMPDIR: root, SUBFORGE_DB: db, PORT: '0', HOST: '127.0.0.1', PUBLIC_URL: 'http://127.0.0.1', SUBFORGE_SECRET: Buffer.from('11'.repeat(32), 'hex').toString('base64') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += String(chunk); });
  child.stderr.on('data', chunk => { output += String(chunk); });
  const exited = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  try {
    const end = Date.now() + 6000;
    while (!/已启动：http:\/\/127\.0\.0\.1:\d+/.test(output)) {
      if (Date.now() > end) throw new Error(`等待超时：${output}`);
      await sleep(50);
    }
    child.kill('SIGTERM');
    expect(await exited).toBe(0);
    expect(output).not.toMatch(/unhandled|关闭服务失败/i);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
    await rm(root, { recursive: true, force: true });
  }
}, 12000);
