import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderSurge, stringifySurge } from '../src/index.ts';
import { iniFixture, routing } from './fixtures/ini-client.ts';

describe('Surge 完整订阅', () => {
  it('基础设置、内联节点、组、规则、代理链共用解析，输入快照保持不变', () => {
    const f = iniFixture();
    f.profile.chains = [{ id: 'chain', landing: { nodeSet: { type: 'local', id: 'nodes' }, filter: '日本' }, via: { kind: 'node', ref: { nodeSet: { type: 'local', id: 'nodes' }, match: { exact: '香港' } } } }];
    const before = JSON.stringify(f), out = renderSurge(f);
    expect(out.report.hasErrors, JSON.stringify(out.report.items)).toBe(false);
    expect(out.providers).toEqual({});
    expect(out.yaml).toContain('[General]\nloglevel = notify\nipv6 = false');
    expect(out.yaml).toContain('[Host]\nlocal.example.test = 192.0.2.1');
    expect(out.yaml).toContain('日本 = hysteria2, jp.example.test, 443, password="hy2-example", download-bandwidth=1000, underlying-proxy=香港');
    expect(out.yaml).toContain('代理 = select, 香港, 日本');
    expect(out.yaml).toContain('USER-AGENT,Example*,代理\nFINAL,DIRECT');
    expect(out.yaml).not.toContain('empty-fallback');
    expect(JSON.stringify(f)).toBe(before);
  });
  it('测速超时毫秒转秒并下放节点，拒绝共享节点冲突', () => {
    const f = iniFixture(), group = routing(f).groups[0]!;
    group.type = 'url-test'; group.test = { url: 'http://example.test/204', timeout: 1500, interval: 300, tolerance: 0 };
    const out = renderSurge(f);
    expect(out.report.hasErrors).toBe(false);
    expect(out.yaml).toContain('test-url=http://example.test/204, test-timeout=1.5');
    expect(out.yaml).toContain('代理 = url-test, 香港, 日本, interval=300, tolerance=0');
    routing(f).groups.push({ id: 'other', name: '其他', type: 'fallback', members: [{ kind: 'group', groupId: 'all' }], test: { timeout: 5000 } });
    expect(renderSurge(f).report.byCode('surge.benchmark-conflict')).toHaveLength(2);
  });
  it('四种组类型可输出，非等价算法报错，空组固定 REJECT', () => {
    const f = iniFixture(), group = routing(f).groups[0]!;
    group.filter = '不存在';
    expect(renderSurge(f).yaml).toContain('代理 = select, REJECT');
    delete group.filter;
    group.type = 'load-balance'; group.strategy = 'consistent-hashing';
    expect(renderSurge(f).yaml).toContain('代理 = load-balance, 香港, 日本, persistent=true');
    group.strategy = 'round-robin';
    expect(renderSurge(f).report.byCode('surge.group-strategy')[0]?.level).toBe('error');
    delete group.strategy; group.type = 'fallback';
    expect(renderSurge(f).yaml).toContain('代理 = fallback, 香港, 日本');
    group.extra = { proxies: ['DIRECT'], name: '覆盖' };
    expect(renderSurge(f).report.byCode('surge.group-option')).toHaveLength(2);
    expect(renderSurge(f).yaml).toContain('代理 = fallback, 香港, 日本');
  });
  it('内联重名仍按原快照名称筛选并解析引用', () => {
    const f = iniFixture();
    f.nodeSets.locals.other = { id: 'other', name: '另一个节点集', proxies: [{ name: '香港', type: 'trojan', server: 'other.example.test', port: 443, password: 'other' }] };
    f.profile.nodeSets.push({ ref: { type: 'local', id: 'other' }, output: 'provider' });
    routing(f).groups[0]!.members = [{ kind: 'node', ref: { nodeSet: { type: 'local', id: 'other' }, match: { exact: '香港' } } }];
    expect(renderSurge(f).yaml).toContain('代理 = select, 香港 2');
  });
  it('托管链接和独立导出保持原顺序与逐行选项', () => {
    const f = iniFixture();
    f.rules.rulesets.rs = { id: 'rs', name: '规则', sources: [{ id: 'local', kind: 'local', format: 'auto', content: 'DOMAIN,a.test,extended-matching\nIP-CIDR,192.0.2.0/24,no-resolve' }] };
    routing(f).rules.unshift({ id: 'rs', matcher: { kind: 'ruleset', id: 'rs' }, target: { kind: 'group', groupId: 'all' } });
    const out = renderSurge(f);
    expect(out.report.hasErrors, JSON.stringify(out.report.items)).toBe(false);
    expect(out.yaml).toContain('RULE-SET,https://sub.test/r/rs_rs_classical.list?v=test&target=surge,代理');
    const file = stringifySurge(out, true);
    expect(file).toContain('[Rule]\nDOMAIN,a.test,代理,extended-matching\nIP-CIDR,192.0.2.0/24,代理,no-resolve\nUSER-AGENT,Example*,代理\nFINAL,DIRECT');
    expect(file).not.toContain('https://sub.test/');
  });
  it('节点关键字段正确映射，未知协议、换行和链与端口跳跃冲突被拒绝', () => {
    const f = iniFixture();
    const nodes = f.nodeSets.locals.nodes!.proxies;
    nodes[0] = { name: '香港', type: 'vmess', server: 'vmess.example.test', port: 443, uuid: '0233d11c-15a4-47d3-ade3-48ffca0ce119', alterId: 0, cipher: 'auto', tls: true, network: 'ws', 'ws-opts': { path: '/ws', headers: { Host: 'cdn.example.test' } }, 'ip-version': 'ipv4' };
    nodes[1]!.obfs = 'salamander'; nodes[1]!['obfs-password'] = 'example-obfs';
    const out = renderSurge(f);
    expect(out.report.hasErrors, JSON.stringify(out.report.items)).toBe(false);
    expect(out.yaml).toContain('vmess-aead=true');
    expect(out.yaml).toContain('ws-headers="Host:cdn.example.test", ip-version=v4-only');
    expect(out.yaml).toContain('salamander-password="example-obfs"');
    nodes[1]!.ports = '4000-5000'; nodes[1]!['dialer-proxy'] = '香港';
    expect(renderSurge(f).report.hasErrors).toBe(true);
    delete nodes[1]!.ports; delete nodes[1]!['dialer-proxy'];
    nodes[0]!.type = 'vless';
    expect(renderSurge(f).report.hasErrors).toBe(true);
    nodes[0]!.type = 'vmess'; nodes[0]!.name = '名称\n[Rule]';
    expect(renderSurge(f).report.hasErrors).toBe(true);
  });
  it('沿用环检测，二进制规则和非苹果平台不假报成功', () => {
    const f = iniFixture();
    f.profile.chains = [{ id: 'self', landing: { nodeSet: { type: 'local', id: 'nodes' } }, via: { kind: 'group', groupId: 'all' } }];
    expect(renderSurge(f).report.byCode('chain.cycle').length).toBeGreaterThan(0);
    f.profile.chains = []; f.platform = 'linux';
    expect(renderSurge(f).report.byCode('surge.platform')).toHaveLength(1);
    f.rules.rulesets.rs = { id: 'rs', name: '二进制', sources: [{ id: 'remote', kind: 'remote', url: 'https://example.test/r.mrs', format: 'mrs', behavior: 'domain' }] };
    routing(f).rules.push({ id: 'binary', matcher: { kind: 'ruleset', id: 'rs' }, target: { kind: 'builtin', name: 'DIRECT' } });
    expect(renderSurge(f).report.byCode('ruleset.conversion-unavailable')).toHaveLength(1);
  });
});

it.skipIf(!process.env.SURGE_BIN)('Surge 官方离线检查：基础配置、四类组、常用节点与完整规则', () => {
  const f = iniFixture(), groups = routing(f).groups;
  routing(f).rules.push(
    { id: 'ports', matcher: { kind: 'rule', rule: { type: 'DST-PORT', value: '80/443/8000-9000' } }, target: { kind: 'group', groupId: 'all' } },
    { id: 'source-ports', matcher: { kind: 'rule', rule: { type: 'SRC-PORT', value: '12345/12346' } }, target: { kind: 'group', groupId: 'all' } },
  );
  const nodes = f.nodeSets.locals.nodes!.proxies;
  nodes.push(
    { name: 'SS', type: 'ss', server: 'ss.example.test', port: 443, cipher: 'aes-128-gcm', password: 'example' },
    { name: 'VMess', type: 'vmess', server: 'v.example.test', port: 443, uuid: '0233d11c-15a4-47d3-ade3-48ffca0ce119', alterId: 0, cipher: 'auto', tls: true, network: 'ws', 'ws-opts': { path: '/ws', headers: { Host: 'cdn.example.test' } } },
    { name: 'HTTP', type: 'http', server: 'h.example.test', port: 443, username: 'example', password: 'example', tls: true },
    { name: 'SOCKS', type: 'socks5', server: 's.example.test', port: 1080 },
    { name: 'Snell', type: 'snell', server: 'snell.example.test', port: 443, psk: 'example', version: 4 },
    { name: 'TUIC', type: 'tuic', server: 't.example.test', port: 443, uuid: '0233d11c-15a4-47d3-ade3-48ffca0ce119', password: 'example' },
    { name: 'AnyTLS', type: 'anytls', server: 'a.example.test', port: 443, password: 'example' },
  );
  for (const type of ['url-test', 'fallback', 'load-balance'] as const) groups.push({ id: type, name: type, type, members: [{ kind: 'nodeset', ref: { type: 'local', id: 'nodes' } }], test: { url: 'http://example.test/204', timeout: 5000, interval: 300 } });
  const out = renderSurge(f);
  expect(out.report.hasErrors, JSON.stringify(out.report.items)).toBe(false);
  const dir = mkdtempSync(join(tmpdir(), 'sub-forge-surge-'));
  try {
    const file = join(dir, 'surge.conf'); writeFileSync(file, out.yaml);
    const check = execFileSync(process.env.SURGE_BIN!, ['--check', file], { encoding: 'utf8' });
    expect(check.trim()).toBe('OK');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
