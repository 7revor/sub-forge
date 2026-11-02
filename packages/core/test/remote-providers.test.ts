import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderSurge, renderLoon, renderStash, parseContent, type RenderInput } from '../src/index.ts';

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
      expect(out.yaml).toContain('代理 = select, policy-path=https://sub.test/nodes?id=local%3Aa, update-interval=7200');
      expect(out.yaml).not.toContain('香港 =');
    } else if (client === 'loon') {
      expect(out.yaml).toContain('[Remote Proxy]\n机场 A = https://sub.test/nodes?id=local%3Aa,parser-enabled=false,enabled=true');
      expect(out.yaml).toContain('代理 = select, 机场 A');
      expect(out.yaml).not.toContain('香港 =');
    } else {
      expect(out.config['proxy-providers']).toEqual({ '机场 A': { url: 'https://sub.test/nodes?id=local%3Aa', interval: 7200 } });
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
    expect(out.config['proxy-groups']).toMatchObject([{ name: '代理', proxies: ['REJECT'] }, { name: '展开组', proxies: ['内联'] }]);
    if (client === 'surge') {
      const combined = Object.entries(out.providers).find(([key]) => key.startsWith('view:'))![1];
      expect(providerNodes(client, combined.yaml).map((n: any) => n.name)).toEqual(['香港', '日本', '美国']);
      expect(combined.sourceKeys).toEqual(['local:a', 'local:c']);
    } else expect((out.config['proxy-groups'] as any[])[0].use).toEqual(['机场 A', '机场 C']);
  });
  it('包含、排除及类型筛选在远程资源刷新时重新执行，资源地址不随节点数量变化', () => {
    const f = fixture();
    groups(f)[0]!.filter = '香港|日本'; groups(f)[0]!.excludeFilter = '测试'; groups(f)[0]!.excludeType = 'http';
    const out = render(f), [key, subset] = Object.entries(out.providers).find(([key]) => key.startsWith('view:'))!;
    expect(out.report.hasErrors).toBe(false);
    expect(providerNodes(client, subset.yaml).map((n: any) => n.name)).toEqual(['香港']);
    f.nodeSets.locals.a!.proxies.push(node('香港 2'), node('香港 测试'));
    const updated = render(f);
    expect(providerNodes(client, updated.providers[key]!.yaml).map((n: any) => n.name)).toEqual(['香港', '香港 2']);
    expect(updated.config['proxy-groups']).toEqual(out.config['proxy-groups']);
    f.nodeSets.locals.a!.proxies = [node('日本', 'http')];
    const empty = render(f);
    expect((empty.config['proxy-groups'] as any[])[0]).toMatchObject({ proxies: ['REJECT'] });
    expect((empty.config['proxy-groups'] as any[])[0].use).toBeUndefined();
    expect((empty.config['proxy-groups'] as any[])[0]['policy-path']).toBeUndefined();
    expect(empty.providers[key]).toBeUndefined();
  });
  it('远程来源重名仍按原名称筛选，单节点引用只选中指定来源', () => {
    const f = fixture();
    f.profile.nodeSets.push({ ref: ref('c'), output: 'provider' });
    f.nodeSets.locals.c = { id: 'c', name: '机场 C', proxies: [node('香港')] };
    groups(f)[0]!.members = [{ kind: 'node', ref: { nodeSet: ref('c'), match: { exact: '香港' } } }];
    const out = render(f);
    expect(out.report.hasErrors, JSON.stringify(out.report.items)).toBe(false);
    const subset = Object.entries(out.providers).find(([key]) => key.startsWith('view:'))![1];
    expect(providerNodes(client, subset.yaml).map((n: any) => n.name)).toEqual(['香港 2']);
    expect(subset.sourceKeys).toEqual(['local:c']);
  });
  it('空来源不生成可退回直连的远程组', () => {
    const f = fixture(); f.nodeSets.locals.a!.proxies = [];
    const out = render(f);
    expect(out.providers['local:a']!.nodeCount).toBe(0);
    expect(out.config['proxy-providers']).toBeUndefined();
    expect(out.config['proxy-groups']).toMatchObject([{ proxies: ['REJECT'] }]);
    expect(out.yaml).not.toMatch(/policy-path=|\[Remote Proxy\]/);
  });
  it('同来源重复名称的精确引用只选第一个节点，不扩大为两个成员', () => {
    const f = fixture(); f.nodeSets.locals.a!.proxies.push(node('香港'));
    groups(f)[0]!.members = [{ kind: 'node', ref: { nodeSet: ref('a'), match: { exact: '香港' } } }];
    const out = render(f);
    expect(out.report.hasErrors).toBe(false);
    const subset = Object.entries(out.providers).find(([key]) => key.startsWith('view:'))![1];
    expect(providerNodes(client, subset.yaml).map((n: any) => n.name)).toEqual(['香港']);
  });
  it('内联落地可以引用远程前置，保留精确节点范围', () => {
    const f = fixture();
    f.profile.chains = [{ id: 'c', landing: { nodeSet: ref('b') }, via: { kind: 'node', ref: { nodeSet: ref('a'), match: { exact: '香港' } } } }];
    const out = render(f);
    expect(out.report.hasErrors, JSON.stringify(out.report.items)).toBe(false);
    expect((out.config.proxies as any[])[0]['dialer-proxy']).toMatch(/^__ref_/);
    const subset = Object.entries(out.providers).find(([key]) => key.startsWith('view:'))![1];
    expect(providerNodes(client, subset.yaml).map((n: any) => n.name)).toEqual(['香港']);
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
it('Surge 远程正文保留 underlying-proxy，Stash 同集前置直接引用集内节点', () => {
  const f = fixture(); f.profile.chains = [{ id: 'c', landing: { nodeSet: ref('a'), filter: '^日本$' }, via: { kind: 'node', ref: { nodeSet: ref('a'), match: { exact: '香港' } } } }];
  const surge = renderSurge(f), stash = renderStash(f), loon = renderLoon(f);
  expect(surge.report.hasErrors).toBe(false);
  expect(surge.providers['local:a']!.yaml).toContain('underlying-proxy=__ref_');
  expect(stash.report.hasErrors).toBe(false);
  expect(parse(stash.providers['local:a']!.yaml).proxies[1]['dialer-proxy']).toBe('香港');
  expect(loon.report.byCode('loon.provider-chain')[0]?.level).toBe('error');
  expect(loon.config.proxies).toHaveLength(1);
});
it('Stash 不把跨远程来源的前置伪装成有效代理链', () => {
  const f = fixture(); f.profile.nodeSets[1]!.output = 'provider';
  f.profile.chains = [{ id: 'c', landing: { nodeSet: ref('b') }, via: { kind: 'node', ref: { nodeSet: ref('a'), match: { exact: '香港' } } } }];
  expect(renderStash(f).report.byCode('stash.provider-chain')[0]?.level).toBe('error');
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
