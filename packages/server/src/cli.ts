// 命令行入口：
//   tsx src/cli.ts seed <seed.json>   导入种子文件
//   tsx src/cli.ts serve              启动订阅服务
// 配置全部来自环境变量，见 packages/server/README.md。

import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { Cipher, loadMasterKey } from './crypto.ts';
import type { Seed } from './docs.ts';
import { parseAllowList } from './net/ssrf.ts';
import { createUpstreamFetcher } from './net/upstream.ts';
import { RenderService } from './render.ts';
import { SnapshotService } from './snapshots.ts';
import { Store } from './store.ts';
import { mihomoVerifier } from './verify.ts';

const env = process.env;
const dbPath = env.SUBFORGE_DB ?? './data/sub-forge.db';

function openStore(): Store {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  return new Store(dbPath, { cipher: new Cipher(loadMasterKey(dbPath, env.SUBFORGE_SECRET)) });
}

function seed(file: string | undefined): void {
  if (!file) throw new Error('用法：cli.ts seed <seed.json>');
  const store = openStore();
  try {
    store.importSeed(JSON.parse(readFileSync(file, 'utf8')) as Seed);
    console.log(`已导入 ${file} → ${dbPath}`);
  } finally {
    store.close();
  }
}

function start(): void {
  const host = env.HOST ?? '127.0.0.1';
  const port = Number(env.PORT ?? 8080);
  const store = openStore();
  const fetcher = createUpstreamFetcher({ allow: parseAllowList((env.SSRF_ALLOW ?? '').split(',')) });
  const snapshots = new SnapshotService(store, fetcher);
  const renderer = new RenderService(store, snapshots, {
    publicUrl: env.PUBLIC_URL ?? `http://${host}:${port}`,
    ...(env.MIHOMO_BIN ? { verify: mihomoVerifier(env.MIHOMO_BIN, env.MIHOMO_DIR) } : {}),
  });
  const publicUrl = env.PUBLIC_URL ?? `http://${host}:${port}`;
  const app = createApp({
    store, renderer, snapshots,
    secureCookies: publicUrl.startsWith('https://'),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  });
  const server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
    console.log(`sub-forge 已启动：http://${info.address}:${info.port}（数据库 ${dbPath}）`);
  });
  const shutdown = () => {
    server.close(async () => {
      await snapshots.settled();
      store.close();
      process.exit(0);
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'seed') seed(arg);
else if (cmd === 'serve') start();
else {
  console.error('用法：cli.ts seed <seed.json> | serve');
  process.exit(1);
}
