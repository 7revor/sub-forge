#!/usr/bin/env node
// 生命周期测试用控制器：模拟延迟接口、启动失败和无法优雅退出的内核。
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const dir = process.argv[process.argv.indexOf('-d') + 1];
const config = fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8');
fs.appendFileSync(path.join(path.dirname(dir), 'pids'), `${process.pid}\n`);
if (config.includes('exit.example')) process.exit(1);
process.on('SIGTERM', () => {});
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/version' && config.includes('notready.example')) { res.statusCode = 503; return res.end('{}'); }
  if (req.url === '/version') return res.end('{"version":"test"}');
  if (config.includes('hang.example')) return;
  if (config.includes('fail.example')) { res.statusCode = 504; return res.end('{"message":"authentication failed secret-password"}'); }
  res.end('{"delay":42}');
});
server.listen(path.join(dir, 'api.sock'));
