import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderSurge, renderLoon, renderStash, renderMihomo, parseContent, type RenderInput } from '../src/index.ts';

const ref = (id: string) => ({ type: 'local' as const, id });
const node = (name: string, type = 'socks5') => ({ name, type, server: 'node.example.test', port: 1080, ...(type === 'http' ? { tls: false } : {}) });
function fixture(): RenderInput {
  return {
    profile: { id: 'p', name: '远程来源', nodeSets: [{ ref: ref('a'), output: 'provider' }, { ref: ref('b'), output: 'inline' }], chains: [],
      routing: { mode: 'independent', config: { groups: [{ id: 'g', name: '代理', type: 'select', members: [{ kind: 'nodeset', ref: ref('a') }] }], rules: [], final: { kind: 'group', groupId: 'g' } } } },
    nodeSets: { sources: {}, collections: {}, snapshots: {}, locals: {
      a: { id: 'a', name: '机场 A', proxies: [node('香港'), node('日本', 'http')] },
      b: { id: 'b', name: '本地 B', proxies: [node('内联')] },
    } }, rules: { rulesets: {}, snapshots: {} }, resourceIntervalSec: 7200,
    urls: { provider: key => 'https://sub.test/nodes?id=' + encodeURIComponent(key), ruleset: key => key },
  };
}
function groups(f: RenderInput) { if (f.profile.routing?.mode !== 'independent') throw new Error('测试需要独立配置'); return f.profile.routing.config.groups; }
const renders = { surge: renderSurge, loon: renderLoon, stash: renderStash };
const providerNodes = (client: string, text: string) => client === 'stash' ? parse(text).proxies : parseContent(text, ref('result')).proxies;

for (const [client, render] of Object.entries(renders)) describe(client + ' 原生远程节点', () => {
  it('引用来源保持远程，展开来源保持内联，原始输入不变', () => {
    const f = fixture(), before = JSON.stringify(f), out = render(f);
    expect(out.report.hasErrors, JSON.stringify(out.report.items)).toBe(false);
    expect(out.config.proxies).toMatchObject([{ name: '内联' }]);
    expect(providerNodes(client, out.providers['local:a']!.yaml).map((n: any) => n.name)).toEqual(['香港', '日本']);
    expect(out.providers['local:b']).toBeUndefined();
    if (client === 'surge') {
      expect(out.yaml).toContain('代理 = select, include-other-group="机场 A"');
      expect(out.yaml).toContain('机场 A = select, policy-path=https://sub.test/nodes?id=local%3Aa, update-interval=7200, hidden=true');
      expect(out.yaml).not.toContain('香港 =');
    } else if (client === 'loon') {
      expect(out.yaml).toContain('[Remote Proxy]\n机场 A = https://sub.test/nodes?id=local%3Aa,parser-enabled=false,enabled=true');
      expect(out.yaml).toContain('代理 = select, 机场 A');
      expect(out.yaml).not.toContain('香港 =');
    } else {
      expect(out.config['proxy-providers']).toEqual({ '机场 A': { type: 'http', url: 'https://sub.test/nodes?id=local%3Aa', interval: 7200, proxy: 'DIRECT' } });
      expect(out.config['proxy-groups']).toMatchObject([{ name: '代理', use: ['机场 A'] }]);
    }
    expect(JSON.stringify(f)).toBe(before);
    f.profile.nodeSets[0]!.output = 'inline';
    const inline = render(f);
    expect(inline.providers).toEqual({});
    expect(inline.config.proxies).toHaveLength(3);
  });
  it('多个来源、全部引用和全部展开的范围独立，混合组保留静态成员', () => {
    const f = fixture();
    f.profile.nodeSets.push({ ref: ref('c'), output: 'provider' });
    f.nodeSets.locals.c = { id: 'c', name: '机场 C', proxies: [node('美国')] };
    groups(f)[0]!.members = [{ kind: 'builtin', name: 'REJECT' }, { kind: 'all', scope: 'providers' }];
    groups(f).push({ id: 'inline', name: '展开组', type: 'select', members: [{ kind: 'all', scope: 'proxies' }] });
    const out = render(f);
    expect(out.report.hasErrors, JSON.stringify(out.report.items)).toBe(false);
    expect((out.config['proxy-groups'] as any[]).slice(0, 2)).toMatchObject([{ name: '代理', proxies: ['REJECT'] }, { name: '展开组', proxies: ['内联'] }]);
    expect(Object.keys(out.providers).some(key => key.startsWith('view:'))).toBe(false);
    if (client === 'surge') expect(out.yaml).toContain('代理 = select, REJECT, include-other-group="机场 A,机场 C"');
    else expect((out.config['proxy-groups'] as any[])[0].use).toEqual(['机场 A', '机场 C']);
  });
  it('名称筛选使用客户端原生能力，不生成派生资源，筛空也不改写成拒绝', () => {
    const f = fixture();
    f.profile.nodeSets.push({ ref: ref('c'), output: 'provider' });
    f.nodeSets.locals.c = { id: 'c', name: '机场 C', proxies: [node('美国')] };
    groups(f)[0]!.members = [{ kind: 'nodeset', ref: ref('a') }, { kind: 'nodeset', ref: ref('c') }];
    groups(f)[0]!.filter = '不存在|香港';
    const out = render(f);
    expect(out.report.hasErrors, JSON.stringify(out.report.items)).toBe(false);
    expect(Object.keys(out.providers).sort()).toEqual(['local:a', 'local:c']);
    if (client === 'surge') expect(out.yaml).toContain('代理 = select, include-other-group="机场 A,机场 C", policy-regex-filter=不存在|香港');
    else if (client === 'loon') {
      expect(out.yaml).toContain('[Remote Filter]\n代理_筛选 = NameRegex,机场 A,机场 C,FilterKey = 不存在|香港');
      expect(out.yaml).toContain('代理 = select, 代理_筛选');
    } else expect((out.config['proxy-groups'] as any[])[0]).toEqual({ name: '代理', type: 'select', use: ['机场 A', '机场 C'], filter: '不存在|香港' });
    groups(f)[0]!.filter = '不存在';
    const empty = render(f);
    expect(empty.report.byCode('group.empty')).toEqual([]);
    expect(empty.yaml).not.toContain('代理 = select, REJECT');
    expect(JSON.stringify((empty.config['proxy-groups'] as any[])[0])).not.toContain('REJECT');
  });
  it('未被任何组引用的来源不声明，资源仍可读取', () => {
    const f = fixture();
    f.profile.nodeSets.push({ ref: ref('c'), output: 'provider' });
    f.nodeSets.locals.c = { id: 'c', name: '未引用', proxies: [node('美国')] };
    const out = render(f);
    expect(out.report.hasErrors, JSON.stringify(out.report.items)).toBe(false);
    expect(out.providers['local:c']).toBeDefined();
    expect(out.yaml).toContain('机场 A');
    expect(out.yaml).not.toContain('未引用');
  });
  it('排除条件原生无法表达，由派生资源筛选且地址稳定，只声明实际引用的集合', () => {
    const f = fixture();
    groups(f)[0]!.filter = '香港|日本'; groups(f)[0]!.excludeFilter = '测试'; groups(f)[0]!.excludeType = 'http';
    const out = render(f), [key, subset] = Object.entries(out.providers).find(([key]) => key.startsWith('view:'))!;
    expect(out.report.hasErrors).toBe(false);
    expect(providerNodes(client, subset.yaml).map((n: any) => n.name)).toEqual(['香港']);
    expect(out.yaml).not.toContain('https://sub.test/nodes?id=local%3Aa');
    expect(out.yaml).not.toContain('exclude-');
    expect(out.yaml).not.toMatch(/policy-regex-filter|Remote Filter|^\s*filter:/m);
    f.nodeSets.locals.a!.proxies.push(node('香港 2'), node('香港 测试'));
    const updated = render(f);
    expect(providerNodes(client, updated.providers[key]!.yaml).map((n: any) => n.name)).toEqual(['香港', '香港 2']);
    expect(updated.config['proxy-groups']).toEqual(out.config['proxy-groups']);
    f.nodeSets.locals.a!.proxies = [node('日本', 'http')];
    const empty = render(f);
    expect(empty.providers[key]).toBeDefined();
    expect(providerNodes(client, empty.providers[key]!.yaml)).toEqual([]);
    expect(empty.config['proxy-groups']).toEqual(out.config['proxy-groups']);
  });
  const wrapper = (out: ReturnType<typeof renderLoon>) => (out.config['proxy-groups'] as any[]).find(g => g.name.startsWith('__ref_'));
  const exactFilter = (out: ReturnType<typeof renderLoon>) => {
    const group = wrapper(out);
    if (client === 'surge') return group['policy-regex-filter'];
    if (client === 'stash') return group.filter;
    return (out.config['remote-filters'] as any)[group.use[0]].filter;
  };
  it('远程来源重名时单节点引用按改名后的名称精确筛选，只选中指定来源', () => {
    const f = fixture();
    f.profile.nodeSets.push({ ref: ref('c'), output: 'provider' });
    f.nodeSets.locals.c = { id: 'c', name: '机场 C', proxies: [node('香港')] };
    groups(f)[0]!.members = [{ kind: 'node', ref: { nodeSet: ref('c'), match: { exact: '香港' } } }];
    const out = render(f);
    expect(out.report.hasErrors, JSON.stringify(out.report.items)).toBe(false);
    expect(providerNodes(client, out.providers['local:c']!.yaml).map((n: any) => n.name)).toEqual(['香港 2']);
    expect(exactFilter(out)).toBe('^香港 2$');
    expect(out.yaml).toContain('机场 C');
    expect(out.yaml).not.toContain('https://sub.test/nodes?id=local%3Aa');
  });
  it('空来源保持引用，资源正常下发空集合', () => {
    const f = fixture(); f.nodeSets.locals.a!.proxies = [];
    const out = render(f);
    expect(out.report.hasErrors, JSON.stringify(out.report.items)).toBe(false);
    expect(providerNodes(client, out.providers['local:a']!.yaml)).toEqual([]);
    expect(out.yaml).toContain('https://sub.test/nodes?id=local%3Aa');
    expect(out.yaml).not.toContain('代理 = select, REJECT');
    expect(JSON.stringify((out.config['proxy-groups'] as any[])[0])).not.toContain('REJECT');
  });
  it('内联落地可以引用远程前置，保留精确节点范围', () => {
    const f = fixture();
    f.profile.chains = [{ id: 'c', landing: { nodeSet: ref('b') }, via: { kind: 'node', ref: { nodeSet: ref('a'), match: { exact: '香港' } } } }];
    const out = render(f);
    expect(out.report.hasErrors, JSON.stringify(out.report.items)).toBe(false);
    expect((out.config.proxies as any[])[0]['dialer-proxy']).toMatch(/^__ref_/);
    expect(exactFilter(out)).toBe('^香港$');
    if (client === 'loon') expect(out.yaml).toContain('[Proxy Chain]');
  });
});

it('Loon 订阅名与策略组重名时分配独立引用名', () => {
  const f = fixture(); f.nodeSets.locals.a!.name = '代理';
  const out = renderLoon(f), alias = out.providers['local:a']!.name;
  expect(alias).not.toBe('代理');
  expect(out.yaml).toContain(`代理 = select, ${alias}`);
  expect(out.yaml).toContain(`${alias} = https://sub.test/nodes`);
});
it('Surge 内联组与策略组重名时分配独立名称', () => {
  const f = fixture(); f.nodeSets.locals.a!.name = '代理';
  const out = renderSurge(f), alias = out.providers['local:a']!.name;
  expect(alias).not.toBe('代理');
  expect(out.yaml).toContain(`代理 = select, include-other-group="${alias}"`);
  expect(out.yaml).toContain(`${alias} = select, policy-path=https://sub.test/nodes`);
});
it('Loon 筛选正则保留反斜杠，含逗号时加引号，多个组共用同一筛选器', () => {
  const f = fixture();
  groups(f)[0]!.filter = 'A\\d{1,2}';
  groups(f).push({ ...groups(f)[0]!, id: 'other', name: '其他' });
  const out = renderLoon(f);
  expect(out.report.hasErrors, JSON.stringify(out.report.items)).toBe(false);
  expect(out.yaml).toContain('代理_筛选 = NameRegex,机场 A,FilterKey = "A\\d{1,2}"');
  expect(out.yaml).toContain('其他 = select, 代理_筛选');
  expect(out.yaml).not.toContain('其他_筛选');
});
it('Surge 远程正文保留 underlying-proxy，Stash 同集前置沿用 Mihomo 隐藏策略组', () => {
  const f = fixture(); f.profile.chains = [{ id: 'c', landing: { nodeSet: ref('a'), filter: '^日本$' }, via: { kind: 'node', ref: { nodeSet: ref('a'), match: { exact: '香港' } } } }];
  const surge = renderSurge(f), stash = renderStash(f), loon = renderLoon(f);
  expect(surge.report.hasErrors).toBe(false);
  expect(surge.providers['local:a']!.yaml).toContain('underlying-proxy=__ref_');
  expect(stash.report.hasErrors).toBe(false);
  expect(parse(stash.providers['local:a']!.yaml).proxies[1]['dialer-proxy']).toBe(parse(renderMihomo(f).providers['local:a']!.yaml).proxies[1]['dialer-proxy']);
  expect(loon.report.byCode('loon.provider-chain')[0]?.level).toBe('error');
  expect(loon.config.proxies).toHaveLength(1);
});
it('Stash 跨来源前置复用 Mihomo 引用，不增加专用诊断', () => {
  const f = fixture(); f.profile.nodeSets[1]!.output = 'provider';
  f.profile.chains = [{ id: 'c', landing: { nodeSet: ref('b') }, via: { kind: 'node', ref: { nodeSet: ref('a'), match: { exact: '香港' } } } }];
  const stash = renderStash(f), mihomo = renderMihomo(f);
  expect(stash.report.items).toEqual(mihomo.report.items);
  expect(stash.providers['local:b']!.yaml).toBe(mihomo.providers['local:b']!.yaml);
  expect(stash.dependencies).toEqual(mihomo.dependencies);
});
it.each([renderSurge, renderStash])('远程测速参数按实际筛选成员写入资源，互不重叠的组允许不同超时', render => {
  const f = fixture();
  groups(f)[0]!.type = 'url-test'; groups(f)[0]!.filter = '香港'; groups(f)[0]!.test = { timeout: 1500 };
  groups(f).push({ ...groups(f)[0]!, id: 'other', name: '其他', filter: '日本', test: { timeout: 3000 } });
  const out = render(f);
  expect(out.report.hasErrors, JSON.stringify(out.report.items)).toBe(false);
  const field = render === renderStash ? 'benchmark-timeout' : 'test-timeout';
  if (render === renderStash) expect(parse(out.providers['local:a']!.yaml).proxies.map((n: any) => n[field])).toEqual([1.5, 3]);
  else expect(out.providers['local:a']!.yaml).toMatch(/test-timeout=1.5[\s\S]*test-timeout=3/);
  delete groups(f)[1]!.filter;
  expect(render(f).report.hasErrors).toBe(true);
});

it.skipIf(!process.env.SURGE_BIN)('Surge 官方检查接受远程来源、筛选及精确远程前置', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sub-forge-remote-check-'));
  try {
    const f = fixture();
    f.urls.provider = key => join(dir, encodeURIComponent(key) + '.list');
    groups(f)[0]!.filter = '香港';
    f.profile.chains = [{ id: 'c', landing: { nodeSet: ref('b') }, via: { kind: 'node', ref: { nodeSet: ref('a'), match: { exact: '香港' } } } }];
    const out = renderSurge(f);
    expect(out.report.hasErrors, JSON.stringify(out.report.items)).toBe(false);
    for (const [key, provider] of Object.entries(out.providers)) writeFileSync(f.urls.provider(key), provider.yaml);
    const path = join(dir, 'surge.conf'); writeFileSync(path, out.yaml);
    expect(execFileSync(process.env.SURGE_BIN!, ['--check', path], { encoding: 'utf8' }).trim()).toBe('OK');
  } finally { for (const file of readdirSync(dir)) unlinkSync(join(dir, file)); rmdirSync(dir); }
});
