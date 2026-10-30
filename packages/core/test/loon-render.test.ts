import { describe, expect, it } from 'vitest';
import { renderLoon, lowerRule, parseRuleLine, prepareRuleDocument, convertRuleDocuments, type RuleSet } from '../src/index.ts';
import { iniFixture, routing } from './fixtures/ini-client.ts';
const fixture = () => {
  const f = iniFixture();
  f.base = { general: { 'ip-mode': 'v4-only', 'allow-wifi-access': false, 'dns-server': ['system', '1.1.1.1'] }, host: { 'local.example.test': '192.0.2.1' } };
  return f;
};
describe('Loon 完整订阅', () => {
  it('输出独立基础配置、位置参数节点、四类组与 FINAL，保留空组拒绝', () => {
    const f = fixture(), config = routing(f), before = JSON.stringify(f);
    for (const type of ['url-test', 'fallback', 'load-balance'] as const) config.groups.push({ id: type, name: type, type, members: [{ kind: 'nodeset', ref: { type: 'local', id: 'nodes' } }], test: { url: 'http://example.test/204', timeout: 1500, interval: 300, tolerance: 0 }, ...(type === 'load-balance' ? { strategy: 'round-robin' } : {}) });
    config.groups.push({ id: 'empty', name: '筛空', type: 'select', members: [{ kind: 'nodeset', ref: { type: 'local', id: 'nodes' } }], filter: '不存在' });
    const snapshot = JSON.stringify(f), out = renderLoon(f);
    expect(out.report.hasErrors, JSON.stringify(out.report.items)).toBe(false);
    expect(out.providers).toEqual({});
    expect(out.yaml).toContain('ip-mode = v4-only\nallow-wifi-access = false');
    expect(out.yaml).toContain('test-timeout = 1.5');
    expect(out.yaml).toContain('香港 = trojan, hk.example.test, 443, "example", transport=tcp');
    expect(out.yaml).toContain('日本 = hysteria2, jp.example.test, 443, "hy2-example", download-bandwidth=1000');
    expect(out.yaml).toContain('url-test = url-test, 香港, 日本, url=http://example.test/204, interval=300, tolerance=0');
    expect(out.yaml).toContain('load-balance = load-balance, 香港, 日本, url=http://example.test/204, interval=300, max-timeout=1500, algorithm=Round-Robin');
    expect(out.yaml).toContain('筛空 = select, REJECT');
    expect(out.yaml).toContain('USER-AGENT,Example*,代理\nFINAL,DIRECT');
    expect(out.yaml).not.toMatch(/empty-fallback|proxy-providers|underlying-proxy/);
    expect(JSON.stringify(f)).toBe(snapshot); expect(before).not.toBe(snapshot);
  });
  it('支持 VLESS Reality、WebSocket Host、SS、HTTP、SOCKS 和 Hysteria2 混淆与跳跃端口', () => {
    const f = fixture();
    f.nodeSets.locals.nodes!.proxies = [
      { name: 'VLESS', type: 'vless', server: 'example.test', port: 443, uuid: '0233d11c-15a4-47d3-ade3-48ffca0ce119', tls: true, flow: 'xtls-rprx-vision', servername: 'tls.example.test', 'client-fingerprint': 'chrome', 'reality-opts': { 'public-key': 'example-key', 'short-id': 'abcdef' }, udp: false, tfo: false, 'ip-version': 'ipv4-prefer' },
      { name: 'WS', type: 'vmess', server: 'example.test', port: 443, uuid: '0233d11c-15a4-47d3-ade3-48ffca0ce119', cipher: 'chacha20-poly1305', alterId: 0, network: 'ws', 'ws-opts': { path: '/ws', headers: { Host: 'cdn.example.test' } }, tls: false },
      { name: 'SS', type: 'ss', server: 'example.test', port: 443, cipher: 'aes-128-gcm', password: 'a,b', plugin: 'obfs', 'plugin-opts': { mode: 'http', host: 'obfs.example.test' } },
      { name: 'HTTP', type: 'http', server: 'example.test', port: 443, username: 'a,b', password: 'example', tls: true },
      { name: 'SOCKS', type: 'socks5', server: 'example.test', port: 443, username: 'example', password: 'example', tls: true },
      { name: 'HY2', type: 'hysteria2', server: 'example.test', port: 443, password: 'example', obfs: 'salamander', 'obfs-password': 'obfs', ports: '20000-20100,30000', 'hop-interval': 30 },
    ];
    const out = renderLoon(f);
    expect(out.report.hasErrors, JSON.stringify(out.report.items)).toBe(false);
    expect(out.yaml).toContain('over-tls=true, flow=xtls-rprx-vision, transport=tcp, public-key=example-key, short-id=abcdef');
    expect(out.yaml).toContain('fast-open=false, udp=false, ip-mode=prefer-v4, tls-profile=chrome');
    expect(out.yaml).toContain('chacha20-ietf-poly1305, "0233d11c-15a4-47d3-ade3-48ffca0ce119", alterId=0, over-tls=false, transport=ws, path=/ws, host=cdn.example.test');
    expect(out.yaml).toContain('Shadowsocks, example.test, 443, aes-128-gcm, "a,b", obfs-name=http');
    expect(out.yaml).toContain('HTTP = https, example.test, 443, "a,b", "example"');
    expect(out.yaml).toContain('SOCKS = socks5, example.test, 443, "example", "example", over-tls=true');
    expect(out.yaml).toContain('salamander-password="obfs", server-ports="20000:20100,30000", hop-interval=30');
  });
  it('多个规则来源原位置内嵌，转换选项和客户端改写生效', () => {
    const f = fixture();
    f.rules.rulesets.rs = { id: 'rs', name: '规则', sources: [{ id: 'local', kind: 'local', format: 'auto', content: 'DOMAIN,a.test\nIP-CIDR,192.0.2.0/24,no-resolve\nDOMAIN,b.test,extended-matching' }], overrides: [{ match: 'DOMAIN,a.test', override: { when: { client: 'loon' }, action: { replace: [{ type: 'DOMAIN', value: 'loon.test' }] } } }] };
    routing(f).rules.unshift({ id: 'rs', matcher: { kind: 'ruleset', id: 'rs' }, target: { kind: 'group', groupId: 'all' } });
    const out = renderLoon(f);
    expect(out.report.hasErrors).toBe(false);
    expect(out.yaml).toContain('[Rule]\nDOMAIN,loon.test,代理\nIP-CIDR,192.0.2.0/24,代理,no-resolve\nUSER-AGENT,Example*,代理\nFINAL,DIRECT');
    expect(out.yaml).not.toMatch(/Remote Rule|RULE-SET|https:\/\/sub.test|extended-matching/);
    expect(out.report.items).toContainEqual(expect.objectContaining({ code: 'rule.client', message: expect.stringContaining('extended-matching') }));
  });
  it('支持代理链，不支持协议、PASS 和不一致测速超时阻止发布', () => {
    const f = fixture(), groups = routing(f).groups;
    f.nodeSets.locals.nodes!.proxies[0]!.type = 'tuic';
    expect(renderLoon(f).report.hasErrors).toBe(true);
    f.nodeSets.locals.nodes!.proxies[0]!.type = 'trojan';
    f.profile.chains = [{ id: 'chain', landing: { nodeSet: { type: 'local', id: 'nodes' }, filter: '日本' }, via: { kind: 'node', ref: { nodeSet: { type: 'local', id: 'nodes' }, match: { exact: '香港' } } } }];
    expect(renderLoon(f).chainResolutions[0]).toMatchObject({ appliedCount: 1 });
    f.profile.chains = []; routing(f).final = { kind: 'builtin', name: 'PASS' };
    expect(renderLoon(f).report.byCode('loon.policy')).toHaveLength(1);
    routing(f).final = { kind: 'builtin', name: 'DIRECT' };
    groups[0]!.type = 'url-test'; groups[0]!.test = { timeout: 1000 };
    groups.push({ id: 'other', name: '其他', type: 'fallback', members: [{ kind: 'group', groupId: 'all' }], test: { timeout: 5000 } });
    expect(renderLoon(f).report.byCode('loon.benchmark-conflict')).toHaveLength(1);
  });
});
describe('Loon 规则能力', () => {
  it.each([
    ['DST-PORT,443', 'DEST-PORT,443'], ['NETWORK,udp', 'PROTOCOL,UDP'],
    ['URL-REGEX,^https://example.test/', 'URL-REGEX,^https://example.test/'],
    ['AND,((DOMAIN,a.test),(DST-PORT,443))', 'AND,((DOMAIN,a.test),(DEST-PORT,443))'],
  ])('转换 %s', (input, text) => {
    expect(lowerRule(parseRuleLine(input), { client: 'loon' })).toMatchObject({ kind: 'ok', text });
  });
  it('unsupported 保留诊断，逻辑条件不能因 iOS 不支持进程而放宽', () => {
    for (const text of ['GEOSITE,cn', 'DOMAIN-REGEX,^example', 'IP-CIDR,192.0.2.0/24,src', 'DOMAIN,a.test,extended-matching', 'AND,((DOMAIN,a.test),(PROCESS-NAME,Example))']) expect(lowerRule(parseRuleLine(text), { client: 'loon', platform: 'ios' }).kind).toBe('drop');
    expect(lowerRule(parseRuleLine('PROCESS-NAME,Example'), { client: 'loon', platform: 'macos' })).toMatchObject({ kind: 'ok', text: 'PROCESS-NAME,Example', note: expect.stringContaining('不区分大小写') });
    expect(lowerRule(parseRuleLine('DOMAIN-WILDCARD,*.test'), { client: 'loon' })).toMatchObject({ kind: 'ok', note: expect.stringContaining('1008') });
  });
  it('规则集输出不把丢弃行当成有效规则', () => {
    const rs: RuleSet = { id: 'rs', name: '规则', sources: [{ id: 's', kind: 'local', format: 'auto', content: 'DOMAIN,a.test\nGEOSITE,cn' }] };
    const documents = new Map(rs.sources.map(s => [s.id, prepareRuleDocument(s.content!, s)]));
    const out = convertRuleDocuments(rs, documents, { client: 'loon' });
    expect(out.stats.output).toBe(1); expect(out.stats.unsupported).toBe(1);
    expect(out.lines).toEqual(['DOMAIN,a.test', '# [Loon 尚未适配 GEOSITE] GEOSITE,cn']);
  });
});
