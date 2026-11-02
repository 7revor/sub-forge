import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { mergeNativeIni, nativeBaseParents, parseNativeYaml, resolveNativeBase, validateNativeBase, validateNativeText, type NativeBase } from '../src/index.ts';

describe('原文追加的保存与生成边界', () => {
  it('保存只检查目标和文本类型，不修复、过滤或重建原文', () => {
    const config: NativeBase = { kernels: { mihomo: '# 未写完\ndns: [', surge: '[General]\nunknown-key = false\n' }, clients: { flclash: 'port: 0\n' } };
    const snapshot = structuredClone(config);
    expect(() => validateNativeBase(config)).not.toThrow(); expect(config).toEqual(snapshot);
    expect(() => resolveNativeBase('mihomo', undefined, config)).toThrow();
    expect(resolveNativeBase('surge', undefined, config)).toContain('unknown-key = false');
    expect(() => validateNativeBase({ kernels: { mihomo: {} } })).toThrow('原始文本');
    expect(() => validateNativeBase({ clients: { unknown: '' } })).toThrow('未知');
    for (const text of ['', '  ', 'dns: [']) expect(() => validateNativeBase({ kernels: { stash: text } })).toThrow('Stash 公共配置已移除');
  });
  it('内核公共追加先于客户端追加；列表整体替换，特殊 DNS 键不拆分', () => {
    const profile: NativeBase = { kernels: { mihomo: 'port: 7891\ndns:\n  enable: true\n  nameserver: [223.5.5.5]\n  nameserver-policy:\n    "geosite:cn,private": 223.5.5.5\n' }, clients: { flclash: 'port: 0\ndns:\n  ipv6: false\n  nameserver: []\n  nameserver-policy:\n    "*.example.test": [https://1.1.1.1/dns-query]\n' } };
    const snapshot = JSON.stringify(profile);
    expect(parse(resolveNativeBase('mihomo', 'flclash', profile))).toEqual({ port: 0, dns: { enable: true, ipv6: false, nameserver: [], 'nameserver-policy': { 'geosite:cn,private': '223.5.5.5', '*.example.test': ['https://1.1.1.1/dns-query'] } } });
    expect(parse(resolveNativeBase('mihomo', 'clash-verge', profile)).port).toBe(7891);
    expect(JSON.stringify(profile)).toBe(snapshot);
    expect(() => resolveNativeBase('surge', 'flclash', profile)).toThrow('不匹配');
  });
  it('INI 保留值、顺序、注释及其他段落，同名参数按层替换', () => {
    const common = '# 原文\n[General]\nipv6 = false\ndns-server = system, 223.5.5.5\nencrypted-dns-server = https://dns.test/query#h3=true\n[Host]\n*.example.test = server:1.1.1.1\n[MITM]\nhostname = *.example.test\n[URL Rewrite]\n^http://a.test/ https://a.test/ 302\n';
    const app = '[General]\ntest-timeout = 0\ndns-server = 9.9.9.9\n[MITM]\nhostname = *.other.test\n';
    const output = mergeNativeIni([common, app]);
    for (const text of ['# 原文', 'ipv6 = false', 'test-timeout = 0', 'encrypted-dns-server = https://dns.test/query#h3=true', '*.example.test = server:1.1.1.1', '[URL Rewrite]', '^http://a.test/ https://a.test/ 302']) expect(output).toContain(text);
    expect(output.match(/\[General\]/g)).toHaveLength(1); expect(output).not.toContain('dns-server = system');
    expect(output).toContain('hostname = *.other.test'); expect(output).not.toContain('hostname = *.example.test');
    const conditional = mergeNativeIni(['[General]\n#!MACOS-ONLY http-listen = 127.0.0.1:7890\nipv6 = false //!REQUIREMENT CORE_VERSION>=22\n', '[General]\nipv6 = true\n']);
    expect(conditional).toContain('#!MACOS-ONLY http-listen = 127.0.0.1:7890');
    expect(conditional).toContain('ipv6 = false //!REQUIREMENT CORE_VERSION>=22');
    expect(conditional).toContain('ipv6 = true');
  });
  it('Stash 只按 Mihomo → 应用追加继承，未识别应用时使用 Mihomo 公共层', () => {
    const profile: NativeBase = {
      kernels: {
        mihomo: '# 内核原文\nmixed-port: 7890\nipv6: true\ndns:\n  enable: true\n  nameserver: [223.5.5.5]\n',
      },
      clients: { 'stash-ios': 'mixed-port: 0\ndns:\n  nameserver: []\n', 'stash-macos': 'ipv6: false\ndns:\n  ipv6: false\n' },
    };
    const original = structuredClone(profile);
    expect(nativeBaseParents('stash', 'stash-ios')).toEqual(['mihomo']);
    expect(nativeBaseParents('stash')).toEqual([]);
    expect(parse(resolveNativeBase('stash', undefined, profile))).toEqual({ 'mixed-port': 7890, ipv6: true, dns: { enable: true, nameserver: ['223.5.5.5'] } });
    expect(parse(resolveNativeBase('stash', 'stash-ios', profile))).toEqual({ 'mixed-port': 0, ipv6: true, dns: { enable: true, nameserver: [] } });
    expect(parse(resolveNativeBase('stash', 'stash-macos', profile))).toEqual({ 'mixed-port': 7890, ipv6: false, dns: { enable: true, nameserver: ['223.5.5.5'], ipv6: false } });
    expect(parse(resolveNativeBase('mihomo', 'flclash', profile))).toEqual({ 'mixed-port': 7890, ipv6: true, dns: { enable: true, nameserver: ['223.5.5.5'] } });
    expect(profile).toEqual(original);
    profile.kernels!.mihomo = 'mixed-port: 7899\ndns:\n  enable: false\n';
    expect(parse(resolveNativeBase('stash', 'stash-macos', profile))).toMatchObject({ 'mixed-port': 7899, dns: { enable: false } });
    expect(profile.clients).toEqual(original.clients);
    // 运行时也不再读取误传的旧槽位；正常保存入口会明确拒绝它。
    expect(parse(resolveNativeBase('stash', undefined, { kernels: { ...profile.kernels, stash: 'mixed-port: 1' } } as NativeBase))['mixed-port']).toBe(7899);
  });
  it('Stash 空追加仍继承 Mihomo；无效上层原文在生成时报错，其他内核不受影响', () => {
    const profile: NativeBase = { kernels: { mihomo: 'dns: [', surge: '[General]\nipv6 = false\n' }, clients: { 'stash-ios': '' } };
    expect(() => validateNativeBase(profile)).not.toThrow();
    expect(() => resolveNativeBase('stash', 'stash-ios', profile)).toThrow();
    expect(resolveNativeBase('surge', undefined, profile)).toContain('ipv6 = false');
    profile.kernels!.mihomo = 'dns: null\nipv6: false\n';
    expect(parse(resolveNativeBase('stash', 'stash-ios', profile))).toEqual({ dns: null, ipv6: false });
  });
  it('生成时拒绝覆盖订阅管理的段落，不会静默删除；listeners 仅在订阅层接受', () => {
    expect(() => validateNativeText('rules: []', 'mihomo')).toThrow('由订阅生成');
    expect(() => validateNativeText('[Proxy]\na = direct', 'surge')).toThrow('由订阅生成');
    expect(() => validateNativeText('#!MANAGED-CONFIG https://example.test/config', 'surge')).toThrow('托管更新地址');
    expect(() => validateNativeText('#SUBSCRIBED https://example.test/config\nmode: rule', 'stash')).toThrow('托管更新地址');
    expect(() => resolveNativeBase('stash', 'stash-ios', { kernels: { mihomo: '#SUBSCRIBED https://example.test/config\nmode: rule' } })).toThrow('托管更新地址');
    expect(() => validateNativeText('listeners: []', 'mihomo')).not.toThrow();
  });
  it('无效 YAML、重复键、循环引用和原型键明确失败', () => {
    for (const text of ['port: 1\nport: 2', 'dns: [', '- port: 7890', '&self {dns: *self}', 'dns: &self [*self]', '__proto__: { polluted: true }']) expect(() => parseNativeYaml(text)).toThrow();
    expect(parseNativeYaml('# 只写注释\n')).toEqual({});
    expect({}).not.toHaveProperty('polluted');
  });
});
