// 统一管理两个开发进程；后端由 Node watch 监听源码并自动重启。
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = process.cwd();
const children = [];
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
  // 保留子进程句柄，全部退出后由 Node 自然退出，避免留下 watcher 或 Vite。
}

process.on('SIGTERM', () => stop());
process.on('SIGINT', () => stop());

function start(name, args, cwd) {
  console.log(`正在启动${name}开发服务…`);
  const child = spawn(process.execPath, args, { cwd, env: process.env, stdio: 'inherit' });
  children.push(child);
  child.on('error', (error) => {
    console.error(`${name}启动失败：${error.message}`);
    stop(1);
  });
  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(`${name}开发进程已退出（${signal ?? code}），正在停止另一开发进程。`);
      stop(1);
    }
  });
}

start('后端', ['--watch', '--watch-preserve-output', '--import', 'tsx', 'src/cli.ts', 'serve'],
  resolve(root, 'packages/server'));
start('前端', [resolve(root, 'packages/web/node_modules/vite/bin/vite.js'),
  '--host', '127.0.0.1', '--port', process.env.SUBFORGE_LOCAL_WEB_PORT, '--strictPort'],
  resolve(root, 'packages/web'));
