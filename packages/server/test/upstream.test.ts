import { describe, expect, it } from 'vitest';
import { assertUrlAllowed, isBlockedAddress, parseAllowList, SsrfError } from '../src/net/ssrf.ts';
import { createUpstreamFetcher, parseUserinfo, type FetchLike } from '../src/net/upstream.ts';
import { SnapshotService } from '../src/snapshots.ts';
import { Store } from '../src/store.ts';

const NONE = parseAllowList([]);

describe('SSRF 防护', () => {
  it('内网与保留地址被拦截，公网放行', () => {
    for (const a of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isBlockedAddress(a, NONE), a).toBe(true);
    }
    for (const a of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111']) expect(isBlockedAddress(a, NONE), a).toBe(false);
  });

  it('白名单可放行指定 IP / 网段 / 主机名', () => {
    const allow = parseAllowList(['192.168.1.10', '10.8.0.0/16', 'sub.home.arpa']);
    expect(isBlockedAddress('192.168.1.10', allow)).toBe(false);
    expect(isBlockedAddress('192.168.1.11', allow)).toBe(true);
    expect(isBlockedAddress('10.8.3.4', allow)).toBe(false);
    expect(() => assertUrlAllowed(new URL('http://sub.home.arpa/x'), allow)).not.toThrow();
  });

  it('URL 预检：协议与字面 IP', () => {
    expect(() => assertUrlAllowed(new URL('file:///etc/passwd'), NONE)).toThrow(SsrfError);
    expect(() => assertUrlAllowed(new URL('http://127.0.0.1:8080/'), NONE)).toThrow(SsrfError);
    expect(() => assertUrlAllowed(new URL('http://[::1]/'), NONE)).toThrow(SsrfError);
    expect(() => assertUrlAllowed(new URL('https://example.com/'), NONE)).not.toThrow();
  });

  it('域名无需白名单，IP 字面量经 URL 规范化后仍受限制', () => {
    for (const host of ['localhost', 'sub.home.arpa', 'weir.huajuanmantou.top']) {
      expect(() => assertUrlAllowed(new URL(`https://${host}/sub`), NONE)).not.toThrow();
    }
    for (const host of ['198.18.0.152', '127.1', '2130706433', '0x7f000001', '[::ffff:127.0.0.1]']) {
      expect(() => assertUrlAllowed(new URL(`http://${host}/sub`), NONE), host).toThrow(SsrfError);
    }
  });
});

describe('上游拉取', () => {
  const respond = (status: number, body = '', headers: Record<string, string> = {}) => ({
    status,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    text: async () => body,
  });

  it('透传 UA、解析 subscription-userinfo', async () => {
    let ua = '';
    const fetchImpl: FetchLike = async (_u, init) => { ua = init.headers['user-agent']!; return respond(200, 'body', { 'subscription-userinfo': 'upload=1; download=2; total=10; expire=1700000000' }); };
    const f = createUpstreamFetcher({ allow: NONE, fetchImpl });
    expect(await f('https://a.example.com/sub', { ua: 'FlClash' })).toEqual({ status: 200, body: 'body', userinfo: { upload: 1, download: 2, total: 10, expire: 1700000000 } });
    expect(ua).toBe('FlClash');
  });

  it('跟随重定向，并逐跳校验目标地址', async () => {
    const seen: string[] = [];
    const fetchImpl: FetchLike = async (u) => {
      seen.push(u);
      if (u.endsWith('/a')) return respond(302, '', { location: '/b' });
      if (u.endsWith('/b')) return respond(301, '', { location: 'http://127.0.0.1/secret' });
      return respond(200, 'x');
    };
    const f = createUpstreamFetcher({ allow: NONE, fetchImpl });
    await expect(f('https://a.example.com/a')).rejects.toThrow(SsrfError);
    expect(seen).toEqual(['https://a.example.com/a', 'https://a.example.com/b']);
  });

  it('非 2xx 与过大的响应报错', async () => {
    const f1 = createUpstreamFetcher({ allow: NONE, fetchImpl: async () => respond(403) });
    await expect(f1('https://a.example.com/')).rejects.toThrow('HTTP 403');
    const f2 = createUpstreamFetcher({ allow: NONE, maxBytes: 3, fetchImpl: async () => respond(200, 'abcd') });
    await expect(f2('https://a.example.com/')).rejects.toThrow(/过大/);
  });

  it('userinfo 解析忽略无效字段', () => {
    expect(parseUserinfo('upload=x; total=5; foo=1')).toEqual({ total: 5 });
    expect(parseUserinfo(null)).toBeUndefined();
  });
});

describe('快照服务', () => {
  // 订阅源快照必须解析得出节点，测试正文用一行节点 URI
  const node = (name: string) => `trojan://pw@${name}.example.com:443#${name}`;
  const setup = (bodies: (string | Error)[]) => {
    let t = 1_000_000;
    let calls = 0;
    const store = new Store(':memory:', { now: () => t });
    const fetcher = async () => {
      const b = bodies[Math.min(calls++, bodies.length - 1)]!;
      await new Promise((r) => setTimeout(r, 5));
      if (b instanceof Error) throw b;
      return { status: 200, body: b };
    };
    const svc = new SnapshotService(store, fetcher, () => t);
    return { store, svc, advance: (ms: number) => { t += ms; }, calls: () => calls };
  };

  it('首次同步拉取；并发请求只拉一次', async () => {
    const { svc, calls } = setup([node('v1')]);
    const [a, b] = await Promise.all([svc.get('source', 's', 'u', { ttlSec: 300 }), svc.get('source', 's', 'u', { ttlSec: 300 })]);
    expect(a.snapshot!.body).toBe(node('v1'));
    expect(b.snapshot!.body).toBe(node('v1'));
    expect(calls()).toBe(1);
  });

  it('过期后先返回旧快照，后台刷新', async () => {
    const { svc, advance, calls } = setup([node('v1'), node('v2')]);
    await svc.get('source', 's', 'u', { ttlSec: 300 });
    advance(301_000);
    const r = await svc.get('source', 's', 'u', { ttlSec: 300 });
    expect(r).toMatchObject({ stale: true, snapshot: { body: node('v1') } });
    await svc.settled();
    expect(calls()).toBe(2);
    expect((await svc.get('source', 's', 'u', { ttlSec: 300 })).snapshot!.body).toBe(node('v2'));
  });

  it('刷新失败时继续使用旧快照，并带上失败原因', async () => {
    const { svc, advance } = setup([node('v1'), new Error('connect timeout')]);
    await svc.get('source', 's', 'u', { ttlSec: 300 });
    advance(301_000);
    await svc.get('source', 's', 'u', { ttlSec: 300 });
    await svc.settled();
    const r = await svc.get('source', 's', 'u', { ttlSec: 300 });
    expect(r.snapshot!.body).toBe(node('v1'));
    expect(r.error).toBe('connect timeout');
  });

  it('从未成功过时返回错误', async () => {
    const { svc } = setup([new Error('HTTP 500')]);
    expect(await svc.get('source', 's', 'u', { ttlSec: 300 })).toEqual({ stale: false, error: 'HTTP 500' });
  });

  it('上游 200 但内容为空或没有节点时记为失败，继续使用上一份快照', async () => {
    const { svc, store, advance } = setup([node('v1'), '', 'not a node list']);
    await svc.get('source', 's', 'u', { ttlSec: 300 });
    for (const reason of ['上游返回了空内容', '上游内容中没有可用节点（1 行无法解析）']) {
      advance(301_000);
      await svc.get('source', 's', 'u', { ttlSec: 300 });
      await svc.settled();
      const r = await svc.get('source', 's', 'u', { ttlSec: 300 });
      expect(r.snapshot!.body).toBe(node('v1'));
      expect(r.error).toBe(reason);
    }
    expect(store.countSnapshots('source', 's', 'u')).toEqual({ ok: 1, failed: 1 }); // 失败记录只保留最近一条
  });

  it('内容与最近一份成功快照相同时只更新拉取时间，不新增快照', async () => {
    const { svc, store, advance } = setup([node('v1'), node('v1'), node('v2'), node('v2')]);
    await svc.get('source', 's', 'u', { ttlSec: 300 });
    const first = store.latestSnapshot('source', 's', 'u')!;
    advance(301_000);
    await svc.refresh('source', 's', 'u');
    const touched = store.latestSnapshot('source', 's', 'u')!;
    expect(touched.id).toBe(first.id);
    expect(touched.fetchedAt).toBe(first.fetchedAt + 301_000);
    expect(store.countSnapshots('source', 's', 'u')).toEqual({ ok: 1, failed: 0 });
    // 刷新后未过期：不再拉取
    expect((await svc.get('source', 's', 'u', { ttlSec: 300 })).stale).toBe(false);
    advance(301_000);
    await svc.refresh('source', 's', 'u');
    advance(301_000);
    await svc.refresh('source', 's', 'u');
    expect(store.countSnapshots('source', 's', 'u')).toEqual({ ok: 2, failed: 0 });
    expect(store.latestSnapshot('source', 's', 'u')!.body).toBe(node('v2'));
  });

  it('无变动的刷新清除此前的失败提示', async () => {
    const { svc, advance } = setup([node('v1'), new Error('HTTP 502'), node('v1')]);
    await svc.get('source', 's', 'u', { ttlSec: 300 });
    advance(301_000);
    expect((await svc.refresh('source', 's', 'u')).ok).toBe(false);
    expect((await svc.get('source', 's', 'u', { ttlSec: 300 })).error).toBe('HTTP 502');
    advance(1_000);
    await svc.refresh('source', 's', 'u');
    expect((await svc.get('source', 's', 'u', { ttlSec: 300 })).error).toBeUndefined();
  });

  it('失败后退避：5 分钟内的订阅请求不再触发拉取，手动刷新不受限', async () => {
    const { svc, advance, calls } = setup([node('v1'), new Error('HTTP 429')]);
    await svc.get('source', 's', 'u', { ttlSec: 3600 });
    advance(3_601_000);
    await svc.get('source', 's', 'u', { ttlSec: 3600 });
    await svc.settled();
    expect(calls()).toBe(2);
    for (let i = 0; i < 5; i++) {
      advance(50_000);
      const r = await svc.get('source', 's', 'u', { ttlSec: 3600 });
      expect(r).toMatchObject({ stale: true, error: 'HTTP 429' });
      expect(r.snapshot!.body).toBe(node('v1'));
    }
    await svc.settled();
    expect(calls()).toBe(2);
    advance(51_000);
    await svc.get('source', 's', 'u', { ttlSec: 3600 });
    await svc.settled();
    expect(calls()).toBe(3);
    await svc.refresh('source', 's', 'u');
    expect(calls()).toBe(4);
  });

  it('从未成功过：退避期内直接返回上次的错误，不阻塞请求', async () => {
    const { svc, advance, calls } = setup([new Error('HTTP 500')]);
    await svc.get('source', 's', 'u', { ttlSec: 300 });
    expect(await svc.get('source', 's', 'u', { ttlSec: 300 })).toEqual({ stale: false, error: 'HTTP 500' });
    expect(calls()).toBe(1);
    advance(300_000);
    await svc.get('source', 's', 'u', { ttlSec: 300 });
    expect(calls()).toBe(2);
  });

  it('TTL 短于 5 分钟的旧数据按 5 分钟算', async () => {
    const { svc, advance, calls } = setup([node('v1'), node('v2')]);
    await svc.get('source', 's', 'u', { ttlSec: 10 });
    advance(60_000);
    expect((await svc.get('source', 's', 'u', { ttlSec: 10 })).stale).toBe(false);
    expect(calls()).toBe(1);
  });

  it('规则集可以保存有效的文本规则', async () => {
    const { svc } = setup(['DOMAIN,a.com']);
    expect((await svc.get('ruleset', 'r', 'u', { ttlSec: 300 })).snapshot!.body).toBe('DOMAIN,a.com');
  });
});
