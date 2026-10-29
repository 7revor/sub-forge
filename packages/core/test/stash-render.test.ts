import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { lowerRule, exportStashConfig, parseRuleLine, renderStash, renderMihomo, type RenderInput, type RuleIR } from '../src/index.ts';

const direct = { kind: 'builtin' as const, name: 'DIRECT' as const };
function fixture(): RenderInput {
  return {
    profile: { id: 'p', name: 'Stash', nodeSets: [{ ref: { type: 'local', id: 'nodes' }, output: 'provider' }], chains: [], refPolicy: { default: 'wrap' }, overlay: {}, routing: { mode: 'independent', config: {
      groups: [{ id: 'all', name: '代理', type: 'select', members: [{ kind: 'nodeset', ref: { type: 'local', id: 'nodes' } }] }],
      rules: [{ id: 'ua', matcher: { kind: 'rule', rule: { type: 'USER-AGENT', value: 'PayPal*' } }, target: { kind: 'group', groupId: 'all' } }], final: direct,
    } } },
    nodeSets: { sources: {}, collections: {}, locals: { nodes: { id: 'nodes', name: '节点集', proxies: [
      { name: '香港', type: 'trojan', server: 'hk.example.test', port: 443, password: 'example' },
      { name: '日本', type: 'hysteria2', server: 'jp.example.test', port: 443, password: 'hy2-example', up: '100 Mbps', down: '1 Gbps' },
    ] } }, snapshots: {} },
    rules: { rulesets: {}, snapshots: {} },
    urls: { provider: key => `https://sub.test/p/${key}`, ruleset: key => `https://sub.test/r/${key}` },
  };
}
const groups = (f: RenderInput) => {
  if (f.profile.routing?.mode !== 'independent') throw new Error('测试需要独立分流');
  return f.profile.routing.config.groups;
};

describe('Stash 完整 YAML 渲染', () => {
  it('按官方字段输出节点、组、规则和代理链，不改变 Mihomo 原配置', () => {
    const f = fixture();
    f.profile.chains = [{ id: 'chain', landing: { nodeSet: { type: 'local', id: 'nodes' }, filter: '日本' }, via: { kind: 'node', ref: { nodeSet: { type: 'local', id: 'nodes' }, match: { exact: '香港' } } } }];
    const before = JSON.stringify(f);
    const out = renderStash(f);
    expect(out.report.hasErrors).toBe(false);
    expect(out.providers).toEqual({});
    expect(out.config['proxy-providers']).toBeUndefined();
    expect(out.config.proxies).toMatchObject([{ name: '香港' }, { name: '日本', auth: 'hy2-example', 'up-speed': 100, 'down-speed': 1000, 'dialer-proxy': '香港' }]);
    expect((out.config.proxies as Record<string, unknown>[])[1]).not.toHaveProperty('password');
    expect(out.config['proxy-groups']).toEqual([{ name: '代理', type: 'select', proxies: ['香港', '日本'] }]);
    expect(out.config.rules).toEqual(['USER-AGENT,PayPal*,代理', 'MATCH,DIRECT']);
    expect(out.report.items).toMatchObject([{ code: 'stash.nodes-inline' }]);
    expect(JSON.stringify(f)).toBe(before);
    const mihomo = renderMihomo(f);
    expect(mihomo.config['proxy-providers']).toBeDefined();
    expect(mihomo.config.rules).not.toContain('USER-AGENT,PayPal*,代理');
  });

  it('独立文件导出仅放入有效规则，丢弃 LIST 诊断注释且保持 no-resolve 顺序', () => {
    const text = exportStashConfig({ config: { 'rule-providers': { rs: { url: 'https://sub.test/r/{token}/rs.list' } }, rules: ['RULE-SET,rs,代理', 'MATCH,DIRECT'] }, rulesets: { 'rs.list': { behavior: 'classical', text: '# [客户端不支持] PROCESS-NAME,App\nDOMAIN,a.test\nIP-CIDR,192.0.2.0/24,no-resolve\n' } } });
    const config = parse(text);
    expect(config.rules).toEqual(['DOMAIN,a.test,代理', 'IP-CIDR,192.0.2.0/24,代理,no-resolve', 'MATCH,DIRECT']);
    expect(config['rule-providers']).toBeUndefined();
    expect(text).not.toContain('{token}');
  });

  it('动态成员和筛选按当前节点集展开，筛空固定拒绝，不向 Stash 输出 empty-fallback', () => {
    const f = fixture();
    groups(f)[0]!.members = [{ kind: 'all', scope: 'providers' }];
    groups(f)[0]!.excludeFilter = '日本';
    expect(renderStash(f).config['proxy-groups']).toEqual([{ name: '代理', type: 'select', proxies: ['香港'] }]);
    groups(f)[0]!.filter = '不存在';
    expect(renderStash(f).config['proxy-groups']).toEqual([{ name: '代理', type: 'select', proxies: ['REJECT'] }]);
    groups(f)[0]!.members = [{ kind: 'all', scope: 'proxies' }];
    delete groups(f)[0]!.filter;
    expect(renderStash(f).config['proxy-groups']).toEqual([{ name: '代理', type: 'select', proxies: ['REJECT'] }]);
  });

  it('延迟测试下放节点并将毫秒转为秒，共享节点冲突明确报错', () => {
    const f = fixture();
    groups(f)[0]!.type = 'url-test';
    groups(f)[0]!.test = { url: 'https://example.test/204', timeout: 1500, interval: 300 };
    const out = renderStash(f);
    expect(out.config.proxies).toMatchObject([{ 'benchmark-url': 'https://example.test/204', 'benchmark-timeout': 1.5 }, { 'benchmark-timeout': 1.5 }]);
    expect(out.config['proxy-groups']).toEqual([{ name: '代理', type: 'url-test', proxies: ['香港', '日本'], interval: 300 }]);
    groups(f).push({ id: 'other', name: '其他', type: 'url-test', members: [{ kind: 'group', groupId: 'all' }], test: { timeout: 5000 } });
    expect(renderStash(f).report.items).toContainEqual(expect.objectContaining({ code: 'stash.benchmark-conflict', level: 'error' }));
  });

  it('不支持的代理、组策略和参数阻止成功输出', () => {
    const f = fixture();
    f.nodeSets.locals.nodes!.proxies[0]!.type = 'sudoku';
    groups(f)[0]!.strategy = 'sticky-sessions';
    groups(f)[0]!.extra = { 'include-all': true };
    const out = renderStash(f);
    expect(out.report.items.filter(x => x.level === 'error').map(x => x.code)).toEqual(['stash.proxy-type', 'stash.group-strategy', 'stash.group-option']);
  });

  it('内联造成的重名仍按原快照名称解析引用和筛选', () => {
    const f = fixture();
    f.nodeSets.locals.other = { id: 'other', name: '另一个节点集', proxies: [{ name: '香港', type: 'trojan', server: 'other.example.test', port: 443, password: 'other' }] };
    f.profile.nodeSets.push({ ref: { type: 'local', id: 'other' }, output: 'provider' });
    groups(f)[0]!.members = [{ kind: 'node', ref: { nodeSet: { type: 'local', id: 'other' }, match: { exact: '香港' } } }];
    const out = renderStash(f);
    expect(out.report.hasErrors).toBe(false);
    expect(out.config['proxy-groups']).toEqual([{ name: '代理', type: 'select', proxies: ['香港 2'] }]);
    groups(f)[0]!.members = [{ kind: 'nodeset', ref: { type: 'local', id: 'other' } }];
    groups(f)[0]!.filter = '^香港$';
    expect(renderStash(f).config['proxy-groups']).toEqual([{ name: '代理', type: 'select', proxies: ['香港 2'] }]);
  });

  it('代理链环仍被检测，不把 interface-name 与 dialer-proxy 组合输出成功', () => {
    const f = fixture();
    f.profile.chains = [{ id: 'self', landing: { nodeSet: { type: 'local', id: 'nodes' } }, via: { kind: 'group', groupId: 'all' } }];
    expect(renderStash(f).report.items.some(x => x.level === 'error' && x.code.startsWith('chain.'))).toBe(true);
    const separate = fixture();
    separate.nodeSets.locals.nodes!.proxies[1]!['interface-name'] = 'en0';
    separate.profile.chains = [{ id: 'via', landing: { nodeSet: { type: 'local', id: 'nodes' }, filter: '日本' }, via: { kind: 'node', ref: { nodeSet: { type: 'local', id: 'nodes' }, match: { exact: '香港' } } } }];
    expect(renderStash(separate).report.items).toContainEqual(expect.objectContaining({ level: 'error', code: 'stash.dialer-interface' }));
  });
});

describe('Stash 规则能力独立于 Surge / Mihomo', () => {
  it.each(['DOMAIN-REGEX,^example', 'GEOSITE,cn', 'NETWORK,tcp', 'DST-PORT,443', 'USER-AGENT,PayPal*'])('原生规则：%s', text => {
    expect(lowerRule(parseRuleLine(text), { client: 'stash', platform: 'ios' })).toEqual({ kind: 'ok', text });
  });
  it('进程规则仅 macOS 生效，精确路径保留 PROCESS-PATH，名称正则可等价降级', () => {
    expect(lowerRule(parseRuleLine('PROCESS-PATH,/usr/bin/ssh'), { client: 'stash', platform: 'macos' })).toMatchObject({ kind: 'ok', text: 'PROCESS-PATH,/usr/bin/ssh' });
    expect(lowerRule(parseRuleLine('PROCESS-NAME-REGEX,^App.*'), { client: 'stash', platform: 'macos' })).toMatchObject({ kind: 'ok', text: 'PROCESS-NAME,App*' });
    for (const platform of [undefined, 'ios'] as const) expect(lowerRule(parseRuleLine('PROCESS-NAME,App'), { client: 'stash', platform })).toMatchObject({ kind: 'drop' });
    expect(lowerRule(parseRuleLine('PROCESS-PATH-WILDCARD,/Apps/*'), { client: 'stash', platform: 'macos' })).toMatchObject({ kind: 'drop' });
    const raw: RuleIR = { type: 'RAW', client: 'stash', text: 'URL-REGEX,^https://example.test/' };
    expect(lowerRule(raw, { client: 'stash' }).kind).toBe('ok');
    expect(lowerRule(raw, { client: 'mihomo' }).kind).toBe('drop');
  });
});
