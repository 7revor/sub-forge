import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import type { NodeSetInputs } from '../src/nodeset/resolve.ts';
import type { Profile } from '../src/types.ts';
import { NODESETS, render, src, trojan } from './fixtures/scenarios.ts';

const groupsOf = (r: ReturnType<typeof render>) => r.config['proxy-groups'] as Record<string, unknown>[];
const group = (r: ReturnType<typeof render>, name: string) => groupsOf(r).find((g) => g.name === name)!;
const providerProxies = (r: ReturnType<typeof render>, key: string) => (parse(r.providers[key]!.yaml) as { proxies: Record<string, unknown>[] }).proxies;

describe('PRD 场景 1：多源不打平', () => {
  it('各源以 provider 输出，proxies 为空，组用 use 引用', () => {
    const r = render({
      nodeSets: [{ ref: { type: 'source', id: 'A' }, output: 'provider' }, { ref: { type: 'source', id: 'T' }, output: 'provider' }],
      overlay: { groupPatches: { hk: { addMembers: [{ kind: 'nodeset', ref: { type: 'source', id: 'A' } }, { kind: 'nodeset', ref: { type: 'source', id: 'T' } }], set: { filter: '(?i)港|HK' } } } },
    });
    expect(r.config.proxies).toEqual([]);
    expect(Object.keys(r.config['proxy-providers'] as object)).toEqual(['机场 A', '中转']);
    expect(group(r, '🇭🇰 香港')).toMatchObject({ type: 'url-test', use: ['机场 A', '中转'], filter: '(?i)港|HK', interval: 300, tolerance: 50 });
    const pp = (r.config['proxy-providers'] as Record<string, Record<string, unknown>>)['机场 A']!;
    expect(pp).not.toHaveProperty('path');
    expect(pp.url).toMatch(/\?v=[0-9a-f]{8}$/);
    expect(r.report.byCode('verify.dangling')).toEqual([]);
  });
});

describe('PRD 场景 3：落地走中转（provider 内节点）', () => {
  const base = {
    nodeSets: [{ ref: { type: 'source' as const, id: 'L' }, output: 'provider' as const }, { ref: { type: 'source' as const, id: 'T' }, output: 'provider' as const }],
  };
  const via = { kind: 'node' as const, ref: { nodeSet: { type: 'source' as const, id: 'T' }, match: { exact: '🇭🇰 IPLC-01' } } };

  it('整源走同一前置：生成包装组 + provider override.dialer-proxy', () => {
    const r = render({ ...base, chains: [{ id: 'c1', landing: { nodeSet: { type: 'source', id: 'L' } }, via }] });
    const wrapper = groupsOf(r).find((g) => String(g.name).startsWith('__ref_T_'))!;
    expect(wrapper).toEqual({ name: wrapper.name, type: 'select', use: ['中转'], filter: '^🇭🇰 IPLC-01$', hidden: true, 'empty-fallback': 'REJECT' });
    expect((r.config['proxy-providers'] as Record<string, Record<string, unknown>>)['落地']!.override).toEqual({ 'dialer-proxy': wrapper.name });
    expect(r.dependencies).toEqual([{ refKey: expect.any(String), nodeSet: 'source:T', node: '🇭🇰 IPLC-01', strategy: 'wrap', output: wrapper.name, usedBy: ['chain:c1'] }]);
    expect(r.report.items.filter((i) => i.level === 'error')).toEqual([]);
  });

  it('只给部分落地挂前置：注入到 Profile 专属 provider 内容中，版本号随之变化', () => {
    const plain = render(base);
    const r = render({ ...base, chains: [{ id: 'c1', landing: { nodeSet: { type: 'source', id: 'L' }, filter: '^L-0' }, via }] });
    const nodes = providerProxies(r, 'source:L');
    const wrapperName = groupsOf(r).find((g) => String(g.name).startsWith('__ref_T_'))!.name;
    expect(nodes.map((n) => n['dialer-proxy'])).toEqual([wrapperName, wrapperName, undefined]);
    expect(r.providers['source:L']!.version).not.toBe(plain.providers['source:L']!.version);
  });

  it('包装组名只依赖节点身份：上游改显示名后名称不变', () => {
    const renamed: NodeSetInputs = { ...NODESETS, sources: { ...NODESETS.sources, T: { ...NODESETS.sources.T!, pipeline: [{ op: 'rename.regex', rules: [{ pattern: 'IPLC', replace: 'IEPL' }] }] } } };
    const a = render({ ...base, chains: [{ id: 'c1', landing: { nodeSet: { type: 'source', id: 'L' } }, via }] });
    const b = render({ ...base, chains: [{ id: 'c1', landing: { nodeSet: { type: 'source', id: 'L' } }, via: { kind: 'node', ref: { nodeSet: { type: 'source', id: 'T' }, match: { exact: '🇭🇰 IEPL-01' } } } }] }, { nodeSets: renamed });
    expect(a.dependencies[0]!.output).toBe(b.dependencies[0]!.output);
  });
});

describe('PRD 场景 4：规则出口为 provider 节点', () => {
  it('规则包拆为 domain / classical / ipcidr 三个 provider，出口指向包装组', () => {
    const r = render({
      nodeSets: [{ ref: { type: 'source', id: 'S' }, output: 'provider' }],
      overlay: { rulePatches: { 'r-fin': { target: { kind: 'node', ref: { nodeSet: { type: 'source', id: 'S' }, match: { exact: '🇺🇸 Home-Broadband' } } } } } },
    });
    const w = r.dependencies[0]!.output;
    expect((r.config.rules as string[]).slice(0, 4)).toEqual([
      `RULE-SET,b_fin_domain,${w}`,
      `RULE-SET,b_fin_classical,${w}`,
      `RULE-SET,b_fin_ipcidr,${w},no-resolve`,
      `RULE-SET,b_fin_broker_mrs,${w},no-resolve`,
    ]);
    expect(r.rulesets.b_fin_domain).toEqual({ behavior: 'domain', text: '+.paypal.com\n' });
    expect(r.rulesets.b_fin_classical).toEqual({ behavior: 'classical', text: 'DOMAIN-KEYWORD,paypal\n' });
    expect((r.config['rule-providers'] as Record<string, unknown>).b_fin_broker_mrs).toMatchObject({ format: 'mrs', behavior: 'ipcidr', url: 'https://example.com/broker.mrs' });
  });
});

describe('PRD 场景 5：模板新增组未填充', () => {
  it('为空时=拒绝输出 REJECT，为空时=直连输出 COMPATIBLE，并告警', () => {
    const r = render({});
    expect(group(r, '🤖 AI 服务').proxies).toEqual(['REJECT']);
    expect(group(r, '📺 国内媒体').proxies).toEqual(['COMPATIBLE']);
    expect(r.report.byCode('group.empty').map((i) => i.where)).toEqual(['group:hk', 'group:ai', 'group:media']);
  });
});

describe('规则输出', () => {
  it('进程规则、no-resolve 位置、MATCH', () => {
    const rules = render({}).config.rules as string[];
    expect(rules).toContain('PROCESS-PATH-WILDCARD,/Applications/*/WeChat.app/*,DIRECT');
    expect(rules).toContain('GEOIP,CN,DIRECT,no-resolve');
    expect(rules.at(-1)).toBe('MATCH,🚀 节点选择');
  });
});

describe('依赖解析策略', () => {
  const ruleToNode = { rulePatches: { 'r-cn': { target: { kind: 'node' as const, ref: { nodeSet: { type: 'source' as const, id: 'S' }, match: { exact: '🇺🇸 Home-Broadband' } } } } } };

  it('复制到本地：provider 中保留原节点，proxies 多一份副本', () => {
    const r = render({ nodeSets: [{ ref: { type: 'source', id: 'S' }, output: 'provider' }], overlay: ruleToNode, refPolicy: { default: 'copy' } });
    expect((r.config.proxies as { name: string }[]).map((p) => p.name)).toEqual(['🇺🇸 Home-Broadband']);
    expect(providerProxies(r, 'source:S')).toHaveLength(1);
    expect(r.config.rules).toContain('GEOIP,CN,🇺🇸 Home-Broadband,no-resolve');
  });

  it('整体内联：该节点集改为 inline 输出，不再生成 provider', () => {
    const r = render({ nodeSets: [{ ref: { type: 'source', id: 'S' }, output: 'provider' }], overlay: ruleToNode, refPolicy: { default: 'inline' } });
    expect(r.config['proxy-providers']).toBeUndefined();
    expect((r.config.proxies as { name: string }[]).map((p) => p.name)).toEqual(['🇺🇸 Home-Broadband']);
  });

  it('引用失效时按 fallback 兜底，没有 fallback 时报错', () => {
    const gone = (fallback?: 'error' | { kind: 'builtin'; name: 'REJECT' }) => ({ rulePatches: { 'r-cn': { target: { kind: 'node' as const, ref: { nodeSet: { type: 'source' as const, id: 'S' }, match: { exact: '不存在' }, ...(fallback ? { fallback } : {}) } } } } });
    const a = render({ nodeSets: [{ ref: { type: 'source', id: 'S' }, output: 'provider' }], overlay: gone({ kind: 'builtin', name: 'REJECT' }) });
    expect(a.config.rules).toContain('GEOIP,CN,REJECT,no-resolve');
    expect(a.report.byCode('ref.fallback')).toHaveLength(1);
    const b = render({ nodeSets: [{ ref: { type: 'source', id: 'S' }, output: 'provider' }], overlay: gone() });
    expect(b.report.byCode('ref.unresolved')).toHaveLength(1);
  });

  it('引用未加入 Profile 的节点集时报错', () => {
    const r = render({ overlay: ruleToNode });
    expect(r.report.byCode('ref.nodeset-not-in-profile')).toHaveLength(1);
  });
});

describe('本地节点落地与上游自带前置', () => {
  it('链规则的落地是本地节点（内联）、前置在 provider 中：写入 dialer-proxy 指向包装组', () => {
    const r = render({
      nodeSets: [{ ref: { type: 'local', id: 'self' }, output: 'inline' }, { ref: { type: 'source', id: 'T' }, output: 'provider' }],
      chains: [{ id: 'c1', landing: { nodeSet: { type: 'local', id: 'self' } }, via: { kind: 'node', ref: { nodeSet: { type: 'source', id: 'T' }, match: { exact: '🇭🇰 IPLC-01' } } } }],
    });
    const p = (r.config.proxies as Record<string, unknown>[])[0]!;
    expect(p['dialer-proxy']).toMatch(/^__ref_T_/);
  });

  it('本地节点自身不带前置：没有链规则时不输出 dialer-proxy', () => {
    const r = render({ nodeSets: [{ ref: { type: 'local', id: 'self' }, output: 'inline' }, { ref: { type: 'source', id: 'T' }, output: 'provider' }] });
    expect((r.config.proxies as Record<string, unknown>[])[0]).not.toHaveProperty('dialer-proxy');
  });

  it('上游自带 dialer-proxy：同源前置也要经包装组（provider 中不能直接写节点名）', () => {
    const up: NodeSetInputs = { ...NODESETS, sources: { ...NODESETS.sources, M: { ...src('M', '源 M'), pipeline: [{ op: 'rename.affix', prefix: 'M·' }] } }, snapshots: { ...NODESETS.snapshots, M: [`proxies:\n  - { name: JP-Relay-in, type: trojan, server: m1, port: 443, password: x, dialer-proxy: SG-Relay }\n  - { name: SG-Relay, type: trojan, server: m2, port: 443, password: y }\n`] } };
    const r = render({ nodeSets: [{ ref: { type: 'source', id: 'M' }, output: 'provider' }] }, { nodeSets: up });
    const nodes = providerProxies(r, 'source:M');
    expect(nodes[0]!['dialer-proxy']).toMatch(/^__ref_M_/);
    expect(r.dependencies[0]!.node).toBe('M·SG-Relay');
  });
});

describe('校验', () => {
  it('跨 provider 的前置环被检测出来', () => {
    const loop: NodeSetInputs = { ...NODESETS, sources: { ...NODESETS.sources } };
    const ref = (set: string, name: string) => ({ kind: 'node' as const, ref: { nodeSet: { type: 'source' as const, id: set }, match: { exact: name } } });
    const r = render({
      nodeSets: [{ ref: { type: 'source', id: 'L' }, output: 'provider' }, { ref: { type: 'source', id: 'T' }, output: 'provider' }],
      chains: [
        { id: 'a', landing: { nodeSet: { type: 'source', id: 'L' }, filter: '^L-01$' }, via: ref('T', '🇭🇰 IPLC-01') },
        { id: 'b', landing: { nodeSet: { type: 'source', id: 'T' }, filter: 'IPLC-01' }, via: ref('L', 'L-01') },
      ],
    }, { nodeSets: loop });
    expect(r.report.byCode('chain.cycle')).toHaveLength(1);
  });

  it('组名与节点重名时报错', () => {
    const clash: NodeSetInputs = { ...NODESETS, sources: { ...NODESETS.sources, X: src('X', 'X') }, snapshots: { ...NODESETS.snapshots, X: [trojan('🚀 节点选择', 'x')] } };
    const r = render({ nodeSets: [{ ref: { type: 'source', id: 'X' }, output: 'inline' }] }, { nodeSets: clash });
    expect(r.report.byCode('name.conflict')).toHaveLength(1);
  });

  it('同一输入输出完全相同（快照）', () => {
    const p: Partial<Profile> = {
      nodeSets: [{ ref: { type: 'source', id: 'L' }, output: 'provider' }, { ref: { type: 'source', id: 'T' }, output: 'provider' }, { ref: { type: 'local', id: 'self' }, output: 'inline' }],
      overlay: { groupPatches: { hk: { addMembers: [{ kind: 'nodeset', ref: { type: 'source', id: 'T' } }] } } },
      chains: [{ id: 'c1', landing: { nodeSet: { type: 'source', id: 'L' } }, via: { kind: 'group', groupId: 'hk' } }],
    };
    const a = render(p);
    expect(a.yaml).toBe(render(p).yaml);
    expect(a.yaml).toMatchSnapshot();
  });
});
