// 配置合法性校验：渲染结果交给真实 mihomo 内核执行 `-t`（只解析配置，不启动代理、不监听端口）。
// 需要环境变量 MIHOMO 指向 mihomo 二进制（v1.19.27+），否则整组跳过：
//   MIHOMO=/path/to/mihomo pnpm --filter @sub-forge/core test
//
// 隔离：macOS 上用 sandbox-exec 禁止 mihomo 的全部网络访问；provider / 规则集地址都指向
// 127.0.0.1:9 这类不可达地址，geo 数据下载地址同样指向本机。任何联网尝试都会表现为校验失败。

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import type { MihomoRenderResult, RenderInput } from '../../src/render/mihomo.ts';
import type { Profile } from '../../src/types.ts';
import { RULES, TEMPLATE, render } from '../fixtures/scenarios.ts';

const MIHOMO = process.env.MIHOMO;
/** GeoIP 数据库路径；提供时校验包含 GEOIP 规则（-t 阶段就要加载 MMDB，缺失时 mihomo 会尝试下载） */
const MMDB = process.env.MIHOMO_MMDB;
const SANDBOX = '/usr/bin/sandbox-exec';
const NO_NETWORK = '(version 1)(allow default)(deny network*)';
const UNREACHABLE = 'http://127.0.0.1:9';

// 没有 MMDB 时去掉 GEOIP 规则：本测试不下载任何数据
const isolated: Partial<RenderInput> = {
  template: MMDB ? TEMPLATE : { ...TEMPLATE, rules: TEMPLATE.rules.filter((r) => r.id !== 'r-cn') },
  urls: {
    provider: (key, v) => `${UNREACHABLE}/p/TOKEN/${encodeURIComponent(key)}?v=${v}`,
    ruleset: (key) => `${UNREACHABLE}/r/TOKEN/${key}`,
  },
  rules: { ...RULES, rulesets: { ...RULES.rulesets, fin: { ...RULES.rulesets.fin!, sources: RULES.rulesets.fin!.sources.map((s) => (s.id === 'broker' ? { ...s, url: `${UNREACHABLE}/broker.mrs` } : s)) } } },
  base: {
    'mixed-port': 0,
    'log-level': 'warning',
    ipv6: false,
    'geodata-mode': false,
    'geo-auto-update': false,
    'geox-url': { geoip: `${UNREACHABLE}/geoip.dat`, geosite: `${UNREACHABLE}/geosite.dat`, mmdb: `${UNREACHABLE}/country.mmdb`, asn: `${UNREACHABLE}/asn.mmdb` },
  },
};

const dirs: string[] = [];

function check(yaml: string): { ok: boolean; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'sf-check-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'config.yaml'), yaml);
  if (MMDB) copyFileSync(MMDB, join(dir, 'Country.mmdb'));
  const args = ['-t', '-d', dir, '-f', join(dir, 'config.yaml')];
  const r = existsSync(SANDBOX)
    ? spawnSync(SANDBOX, ['-p', NO_NETWORK, MIHOMO!, ...args], { encoding: 'utf8', timeout: 30000 })
    : spawnSync(MIHOMO!, args, { encoding: 'utf8', timeout: 30000 });
  return { ok: r.status === 0, output: `${r.stdout}${r.stderr}` };
}

/**
 * `-t` 不解析 provider 内容（file / http 都一样），provider 节点的字段与注入的 dialer-proxy 不在检查范围内。
 * 展开校验：把各 provider 的节点并入顶层 proxies 再跑一次 `-t`，顶层节点的字段和 dialer-proxy 名称都会被检查。
 * 与顶层重名的 provider 节点（复制到本地的副本）跳过。
 */
function flatten(r: MihomoRenderResult): string {
  const config = structuredClone(r.config) as { proxies: { name: string }[] };
  const names = new Set(config.proxies.map((p) => p.name));
  for (const prov of Object.values(r.providers)) {
    for (const n of (parse(prov.yaml) as { proxies: { name: string }[] }).proxies) {
      if (!names.has(n.name)) { names.add(n.name); config.proxies.push(n); }
    }
  }
  return stringify(config, { lineWidth: 0 });
}

const S = (id: string) => ({ type: 'source' as const, id });
const toNode = (set: string, name: string) => ({ kind: 'node' as const, ref: { nodeSet: S(set), match: { exact: name } } });

const SCENARIOS: [string, Partial<Profile>][] = [
  ['空 Profile：模板组全部为空组', {}],
  ['场景 1：多源以 provider 输出', {
    nodeSets: [{ ref: S('A'), output: 'provider' }, { ref: S('T'), output: 'provider' }],
    overlay: { groupPatches: { hk: { addMembers: [{ kind: 'nodeset', ref: S('A') }, { kind: 'nodeset', ref: S('T') }], set: { filter: '(?i)港|HK' } } } },
  }],
  ['场景 3：整源走前置（包装组 + 服务端注入节点 dialer-proxy）', {
    nodeSets: [{ ref: S('L'), output: 'provider' }, { ref: S('T'), output: 'provider' }],
    chains: [{ id: 'c1', landing: { nodeSet: S('L') }, via: toNode('T', '🇭🇰 IPLC-01') }],
  }],
  ['场景 3：部分落地注入前置', {
    nodeSets: [{ ref: S('L'), output: 'provider' }, { ref: S('T'), output: 'provider' }],
    chains: [{ id: 'c1', landing: { nodeSet: S('L'), filter: '^L-0' }, via: toNode('T', '🇭🇰 IPLC-01') }],
  }],
  ['前置是策略组', {
    nodeSets: [{ ref: S('L'), output: 'provider' }, { ref: S('T'), output: 'provider' }],
    overlay: { groupPatches: { hk: { addMembers: [{ kind: 'nodeset', ref: S('T') }] } } },
    chains: [{ id: 'c1', landing: { nodeSet: S('L') }, via: { kind: 'group', groupId: 'hk' } }],
  }],
  ['场景 4：规则包出口为 provider 节点', {
    nodeSets: [{ ref: S('S'), output: 'provider' }],
    overlay: { rulePatches: { 'r-fin': { target: toNode('S', '🇺🇸 Home-Broadband') } } },
  }],
  ['链规则：本地节点（内联）落地，前置在 provider 中', {
    nodeSets: [{ ref: { type: 'local', id: 'self' }, output: 'inline' }, { ref: S('T'), output: 'provider' }],
    chains: [{ id: 'c1', landing: { nodeSet: { type: 'local', id: 'self' } }, via: toNode('T', '🇭🇰 IPLC-01') }],
  }],
  ['旧复制策略自动转换', {
    nodeSets: [{ ref: S('S'), output: 'provider' }],
    overlay: { rulePatches: { 'r-fin': { target: toNode('S', '🇺🇸 Home-Broadband') } } },
    refPolicy: { default: 'copy' },
  }],
  ['旧整集内联策略自动转换', {
    nodeSets: [{ ref: S('S'), output: 'provider' }],
    overlay: { rulePatches: { 'r-fin': { target: toNode('S', '🇺🇸 Home-Broadband') } } },
    refPolicy: { default: 'inline' },
  }],
  ['私有组、私有规则与组参数', {
    nodeSets: [{ ref: S('A'), output: 'provider' }, { ref: S('T'), output: 'inline' }],
    overlay: {
      groupPatches: { hk: { addMembers: [{ kind: 'nodeset', ref: S('A') }, { kind: 'nodeset', ref: S('T') }], set: { filter: 'HK', excludeFilter: 'JP', test: { url: 'https://www.gstatic.com/generate_204', interval: 300, timeout: 3000, tolerance: 50, lazy: true } } } },
      extraGroups: [{ after: 'hk', group: { id: 'lb', name: '⚖️ 负载均衡', type: 'load-balance', strategy: 'consistent-hashing', members: [{ kind: 'all', scope: 'providers' }], test: { url: 'https://www.gstatic.com/generate_204', interval: 600 } } }],
      extraRules: [{ anchor: 'top', rule: { id: 'p1', matcher: { kind: 'rule', rule: { type: 'DOMAIN-SUFFIX', value: 'example.com' } }, target: { kind: 'group', groupId: 'lb' } } }],
    },
  }],
];

describe.skipIf(!MIHOMO)('mihomo -t 配置合法性', () => {
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  it.each(SCENARIOS)('%s', (_title, p) => {
    const r = render(p, isolated);
    expect(r.report.items.filter((i) => i.level === 'error')).toEqual([]);
    const res = check(r.yaml);
    expect(res.ok, `${res.output}\n---- config ----\n${r.yaml}`).toBe(true);
    const flat = flatten(r);
    const resFlat = check(flat);
    expect(resFlat.ok, `展开校验失败\n${resFlat.output}\n---- config ----\n${flat}`).toBe(true);
  });

  it.skipIf(!MMDB)('GEOIP 规则随配置一起校验', () => {
    const r = render({}, isolated);
    expect(r.config.rules).toContain('GEOIP,CN,DIRECT,no-resolve');
    expect(check(r.yaml).ok).toBe(true);
  });

  it('对照：组成员指向不存在的名称时 -t 失败（证明校验真的在检查）', () => {
    const r = render({}, isolated);
    const res = check(r.yaml.replace('      - REJECT', '      - 不存在的节点'));
    expect(res.ok).toBe(false);
  });

  it('对照：provider 节点的 dialer-proxy 写错时，展开校验失败', () => {
    const r = render({
      nodeSets: [{ ref: S('L'), output: 'provider' }, { ref: S('T'), output: 'provider' }],
      chains: [{ id: 'c1', landing: { nodeSet: S('L'), filter: '^L-0' }, via: toNode('T', '🇭🇰 IPLC-01') }],
    }, isolated);
    const key = 'source:L';
    const wrapper = r.dependencies[0]!.output;
    const broken = { ...r, providers: { ...r.providers, [key]: { ...r.providers[key]!, yaml: r.providers[key]!.yaml.replaceAll(wrapper, '不存在的组') } } };
    expect(check(r.yaml).ok).toBe(true);
    expect(check(flatten(broken)).ok).toBe(false);
  });
});
