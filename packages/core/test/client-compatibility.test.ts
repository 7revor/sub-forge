import { describe, expect, it } from 'vitest';
import { parse as parseYaml, stringify } from 'yaml';
import { parseContent, parseRuleLine, type Client } from '../src/index.ts';
import { commonInput, compatibilityCases, outputStatus, renderers, targets } from './fixtures/client-compatibility.ts';
import { routing } from './fixtures/ini-client.ts';

function sample(id: string, target: Client) {
  const f = commonInput();
  const c = compatibilityCases.find(c => c.id === id);
  if (!c) throw new Error('测试场景不存在：' + id);
  c.apply(f); return renderers[target](f);
}

it('从完整 Mihomo YAML 导入节点后经过同一管线，保留凭据和传输字段；基础设置不会随节点导入', () => {
  for (const c of compatibilityCases.filter(c => c.category === '节点')) {
    const f = commonInput(); c.apply(f);
    const source = f.nodeSets.locals.nodes!.proxies;
    const imported = parseContent(stringify({ dns: { enable: true }, tun: { enable: true }, proxies: source, 'proxy-groups': [{ name: '外部组', type: 'select', proxies: ['测试节点'] }] }), { type: 'local', id: 'nodes' });
    expect(imported.failures).toEqual([]);
    expect(imported.proxies).toHaveLength(source.length);
    expect(imported.proxies[0]).toMatchObject(source[0]!);
    f.nodeSets.locals.nodes!.proxies = imported.proxies;
    for (const target of targets) {
      const out = renderers[target](f);
      expect(outputStatus(out), c.id + '/' + target).toBe(c.expected?.[target] ?? 'ok');
      expect(out.config).not.toHaveProperty('dns');
      expect(out.config).not.toHaveProperty('tun');
      expect(out.yaml).not.toContain('外部组');
    }
  }
});

for (const target of targets) describe(`${target} 能力边界`, () => {
  it.each(compatibilityCases)('$category / $label', c => {
    const f = commonInput(); c.apply(f);
    const before = JSON.stringify(f), out = renderers[target](f);
    const status = c.expected?.[target] ?? 'ok';
    expect(outputStatus(out), JSON.stringify(out.report.items)).toBe(status);
    expect(JSON.stringify(f)).toBe(before);
    if (status === 'error') return;
    const ini = target === 'surge' || target === 'loon';
    const textRules = ini ? out.yaml.split('[Rule]\n')[1]!.trim().split('\n') : parseYaml(out.yaml).rules as string[];
    // 被省略的规则不能计为成功转换：只剩 FINAL/MATCH；其他规则须有匹配项和出口。
    expect(textRules).toHaveLength(c.category === '规则' && status !== 'omitted' ? 2 : 1);
    expect(textRules.at(-1)).toBe(ini ? 'FINAL,DIRECT' : 'MATCH,DIRECT');
    if (c.category === '规则' && status !== 'omitted') expect(textRules[0]).toMatch(/,代理(?:,no-resolve|,extended-matching|,src)*$/);
    if (ini) {
      const nodes = out.yaml.split('[Proxy]\n')[1]!.split('\n\n')[0]!.trim().split('\n');
      expect(nodes).toHaveLength(1);
      expect(nodes[0]).toMatch(/^测试节点 = .+, node\.example\.test, 443,/);
      expect(out.yaml).toContain('代理 = ');
      if (c.id === 'nested') expect(out.yaml).toContain('外层 = select, 代理');
    } else {
      const config = parseYaml(out.yaml);
      expect(config.proxies).toHaveLength(1);
      expect(config.proxies[0]).toMatchObject({ name: '测试节点', server: 'node.example.test', port: 443 });
      expect(config['proxy-groups'][0].proxies).toEqual(c.id === 'pass' ? ['PASS'] : ['测试节点']);
      if (c.id === 'nested') expect(config['proxy-groups'][1].proxies).toEqual(['代理']);
    }
  });
});

// 对公共子集逐项核对目标字段和值；仅无错误、输出数量或协议名相同都不充分。
it.each([
  ['ss-aes128', 'encrypt-method=aes-128-gcm, password="example"', 'aes-128-gcm, "example"'],
  ['ss-aes256', 'encrypt-method=aes-256-gcm, password="example"', 'aes-256-gcm, "example"'],
  ['ss-chacha', 'encrypt-method=chacha20-ietf-poly1305', 'chacha20-ietf-poly1305, "example"'],
  ['ss-obfs', 'obfs=http, obfs-host=cdn.example.test', 'obfs-name=http, obfs-host=cdn.example.test'],
  ['vmess-ws', 'ws=true, ws-path=/ws, ws-headers="Host:cdn.example.test"', 'transport=ws, path=/ws, host=cdn.example.test'],
  ['vmess-tcp', 'tls=true, vmess-aead=true', 'alterId=0, over-tls=true, transport=tcp'],
  ['trojan-tls', 'sni=tls.example.test, alpn="h2,http/1.1", skip-cert-verify=false', 'sni=tls.example.test, skip-cert-verify=false, alpn="h2,http/1.1"'],
  ['trojan-udp', 'udp-relay=true, tfo=false', 'fast-open=false, udp=true'],
  ['http', '测试节点 = http, node.example.test, 443, username=example, password="example"', '测试节点 = http, node.example.test, 443, "example", "example"'],
  ['https', '测试节点 = https, node.example.test, 443, username=example, password="example", sni=tls.example.test', '测试节点 = https, node.example.test, 443, "example", "example", sni=tls.example.test'],
  ['socks', '测试节点 = socks5, node.example.test, 443, username=example', '测试节点 = socks5, node.example.test, 443, "example", "example"'],
  ['socks-tls', '测试节点 = socks5-tls, node.example.test, 443', '测试节点 = socks5, node.example.test, 443, "example", "example", over-tls=true'],
  ['anytls', 'password="example", sni=tls.example.test', '"example", sni=tls.example.test'],
  ['hy2', 'password="example", sni=tls.example.test', '"example", sni=tls.example.test'],
  ['hy2-down', 'download-bandwidth=100', 'download-bandwidth=100'],
  ['hy2-obfs', 'salamander-password="example-obfs"', 'salamander-password="example-obfs"'],
  ['hy2-ports', 'port-hopping="20000-20100;30000", port-hopping-interval=30', 'server-ports="20000:20100,30000", hop-interval=30'],
  ['select', '代理 = select, 测试节点', '代理 = select, 测试节点'],
  ['balance-hash', 'persistent=true', 'algorithm=PCC'],
])('%s 的目标节点字段与算法映射', (id, surge, loon) => {
  expect(sample(id!, 'surge').yaml).toContain(surge);
  expect(sample(id!, 'loon').yaml).toContain(loon);
});

it('YAML 节点公共字段保留，Stash Hysteria2 凭据和带宽改为目标字段', () => {
  for (const c of compatibilityCases.filter(c => c.category === '节点')) {
    const f = commonInput(); c.apply(f);
    const source = f.nodeSets.locals.nodes!.proxies[0]!;
    for (const target of ['mihomo', 'stash'] as const) {
      const out = renderers[target](f); if (out.report.hasErrors) continue;
      const wanted = { ...source };
      if (target === 'stash' && wanted.type === 'hysteria2') {
        wanted.auth = wanted.password; delete wanted.password;
        if (wanted.down) { wanted['down-speed'] = 100; delete wanted.down; }
        if (wanted.up) { wanted['up-speed'] = 50; delete wanted.up; }
      }
      expect(parseYaml(out.yaml).proxies[0]).toEqual(wanted);
    }
  }
});

it.each(['url-test', 'fallback'])('%s 的测速位置、秒/毫秒和成员都正确', id => {
  for (const target of targets) {
    const out = sample(id, target), c = parseYaml(['mihomo', 'stash'].includes(target) ? out.yaml : '{}');
    if (target === 'mihomo') expect(c['proxy-groups'][0]).toMatchObject({ url: 'http://example.test/204', timeout: 5000, interval: 300 });
    if (target === 'stash') {
      expect(c.proxies[0]).toMatchObject({ 'benchmark-url': 'http://example.test/204', 'benchmark-timeout': 5 });
      expect(c['proxy-groups'][0]).not.toHaveProperty('timeout');
    }
    if (target === 'surge') expect(out.yaml).toContain('test-url=http://example.test/204, test-timeout=5');
    if (target === 'loon') {
      expect(out.yaml).toContain('test-timeout = 5');
      expect(out.yaml).toContain('url=http://example.test/204, interval=300');
      if (id === 'fallback') expect(out.yaml).toContain('max-timeout=5000');
    }
  }
});

it('常见规则准确改名，no-resolve 保留在出口后，端口集合不扩大范围', () => {
  const lines = ['DOMAIN,a.test', 'IP-CIDR,192.0.2.0/24,no-resolve', 'DST-PORT,443', 'NETWORK,udp', 'DST-PORT,80/443'];
  for (const target of targets) {
    const f = commonInput(); routing(f).rules = lines.map((line, i) => ({ id: String(i), matcher: { kind: 'rule', rule: parseRuleLine(line) }, target: { kind: 'group', groupId: 'all' } }));
    const out = renderers[target](f), ini = target === 'surge' || target === 'loon';
    const rules = ini ? out.yaml.split('[Rule]\n')[1]!.trim().split('\n') : parseYaml(out.yaml).rules;
    const port = ini ? 'DEST-PORT' : 'DST-PORT';
    expect(rules).toEqual(['DOMAIN,a.test,代理', 'IP-CIDR,192.0.2.0/24,代理,no-resolve', `${port},443,代理`, ini ? 'PROTOCOL,UDP,代理' : 'NETWORK,udp,代理', target === 'mihomo' ? 'DST-PORT,80/443,代理' : `OR,((${port},80),(${port},443)),代理`, ini ? 'FINAL,DIRECT' : 'MATCH,DIRECT']);
  }
});
