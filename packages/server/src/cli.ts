// 命令行入口：
//   tsx src/cli.ts create-admin <用户名>          创建管理员，密码取自 SUBFORGE_ADMIN_PASSWORD
//   tsx src/cli.ts seed <seed.json> [用户名]      导入种子文件，有归属的文档写到该用户名下
//   tsx src/cli.ts serve                          启动服务
// 配置全部来自环境变量，见 packages/server/README.md。

import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { Cipher, hashPassword, loadMasterKey } from './crypto.ts';
import type { Seed } from './docs.ts';
import { parseAllowList } from './net/ssrf.ts';
import { createUpstreamFetcher } from './net/upstream.ts';
import { RenderService } from './render.ts';
import { SnapshotService } from './snapshots.ts';
import { Store } from './store.ts';
import { mihomoVerifier } from './verify.ts';

const env = process.env;
const dbPath = env.SUBFORGE_DB ?? './data/sub-forge.db';
const DAY_MS = 86400_000;

function openStore(): Store {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  return new Store(dbPath, { cipher: new Cipher(loadMasterKey(dbPath, env.SUBFORGE_SECRET)) });
}

async function createAdmin(store: Store, username: string, password: string | undefined): Promise<void> {
  if (!password || password.length < 8) throw new Error('请通过 SUBFORGE_ADMIN_PASSWORD 提供至少 8 位的密码');
  if (store.getUserAuth(username)) throw new Error(`用户 ${username} 已存在`);
  store.createUser({ username, passwordHash: await hashPassword(password), role: 'admin' });
  console.log(`已创建管理员 ${username}`);
}

async function main(): Promise<void> {
  const [cmd, arg, arg2] = process.argv.slice(2);
  if (cmd === 'create-admin') {
    if (!arg) throw new Error('用法：cli.ts create-admin <用户名>');
    const store = openStore();
    try { await createAdmin(store, arg, env.SUBFORGE_ADMIN_PASSWORD); } finally { store.close(); }
    return;
  }
  if (cmd === 'seed') {
    if (!arg) throw new Error('用法：cli.ts seed <seed.json> [用户名]');
    const store = openStore();
    try {
      const owner = arg2 ? store.getUserAuth(arg2) : undefined;
      if (arg2 && !owner) throw new Error(`用户 ${arg2} 不存在`);
      store.importSeed(JSON.parse(readFileSync(arg, 'utf8')) as Seed, owner?.id ?? null);
      console.log(`已导入 ${arg} → ${dbPath}${owner ? `（归属 ${owner.username}）` : '（无归属，登录后不可见，仅订阅接口可用）'}`);
    } finally {
      store.close();
    }
    return;
  }
  if (cmd === 'serve') return start();
  throw new Error('用法：cli.ts create-admin <用户名> | seed <seed.json> [用户名] | serve');
}

async function start(): Promise<void> {
  const host = env.HOST ?? '127.0.0.1';
  const port = Number(env.PORT ?? 8080);
  const publicUrl = env.PUBLIC_URL ?? `http://${host}:${port}`;
  if (!env.PUBLIC_URL) console.warn(`未设置 PUBLIC_URL，订阅链接将使用 ${publicUrl}，客户端可能无法访问`);
  const store = openStore();

  // 首次启动且没有任何用户时，可用环境变量创建管理员（便于容器部署）
  if (store.countUsers() === 0) {
    if (env.SUBFORGE_ADMIN_USERNAME) await createAdmin(store, env.SUBFORGE_ADMIN_USERNAME, env.SUBFORGE_ADMIN_PASSWORD);
    else console.warn('尚无任何用户：请运行 create-admin，或设置 SUBFORGE_ADMIN_USERNAME / SUBFORGE_ADMIN_PASSWORD 后重启');
  }

  const fetcher = createUpstreamFetcher({ allow: parseAllowList((env.SSRF_ALLOW ?? '').split(',')) });
  const snapshots = new SnapshotService(store, fetcher);
  const renderer = new RenderService(store, snapshots, {
    publicUrl,
    ...(env.MIHOMO_BIN ? { verify: mihomoVerifier(env.MIHOMO_BIN, env.MIHOMO_DIR) } : {}),
  });
  const app = createApp({
    store, renderer, snapshots, publicUrl,
    ...(env.WEB_DIR ? { webDir: env.WEB_DIR } : {}),
    secureCookies: publicUrl.startsWith('https://'),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  });
  store.pruneAccessLog();
  const prune = setInterval(() => store.pruneAccessLog(), DAY_MS);
  prune.unref();

  const server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
    console.log(`Sub Forge 已启动：http://${info.address}:${info.port}（对外地址 ${publicUrl}，数据库 ${dbPath}）`);
  });
  const shutdown = () => {
    clearInterval(prune);
    server.close(async () => {
      await snapshots.settled();
      store.close();
      process.exit(0);
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
