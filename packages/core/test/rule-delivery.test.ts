import { describe, expect, it } from 'vitest';
import { parseRuleSourceContent, renderMihomo, managedRuleDelivery, type RuleSet, type RuleSetInputs } from '../src/index.ts';

function fixture(body: string, patch: Partial<RuleSet> = {}) {
  const rs: RuleSet = { id: 'r', name: '自动格式', sources: [{ id: 's', kind: 'remote', url: 'https://example.test/rules.txt', format: 'auto' }], ...patch };
  const inputs: RuleSetInputs = { rulesets: { r: rs }, snapshots: { 'r/s': body } };
  return { rs, inputs, decide: () => managedRuleDelivery(rs, { client: 'mihomo' }) };
}
const rendered = (inputs: RuleSetInputs) => renderMihomo({
  profile: { id: 'p', name: '测试', nodeSets: [], chains: [], refPolicy: { default: 'wrap' }, overlay: { extraRules: [{ anchor: 'top', rule: { id: 'r', matcher: { kind: 'ruleset', id: 'r' }, target: { kind: 'builtin', name: 'DIRECT' } } }] } },
  nodeSets: { sources: {}, collections: {}, locals: {}, snapshots: {} }, rules: inputs,
  urls: { provider: key => `https://sub.test/p/${key}`, ruleset: key => `https://sub.test/r/${key}` },
});

describe('按内容识别与自动输出格式', () => {
  it('所有客户端统一托管，mihomo 对 USER-AGENT 保留不支持说明', () => {
    const f = fixture('DOMAIN,paypal.com\nUSER-AGENT,PayPal*');
    expect(f.decide().mode).toBe('managed');
    const text = Object.values(rendered(f.inputs).rulesets)[0]!.text;
    expect(text.split('\n').filter(line => line && !line.startsWith('#'))).toEqual(['DOMAIN,paypal.com']);
    expect(text).toContain('# [mihomo 不支持 USER-AGENT] USER-AGENT,PayPal*');
    expect(managedRuleDelivery(f.rs, { client: 'surge' }).mode).toBe('managed');
  });

  it('Stash 文本转换托管，MRS 使用二进制托管', () => {
    for (const body of ['payload: ["DOMAIN,paypal.test", "USER-AGENT,PayPal*"]', '192.0.2.0/24']) {
      const f = fixture(body);
      expect(managedRuleDelivery(f.rs, { client: 'stash' }).mode).toBe('managed');
    }
    const process = fixture('USER-AGENT,PayPal*\nPROCESS-NAME,Example');
    expect(managedRuleDelivery(process.rs, { client: 'stash' }).mode).toBe('managed');
    const binary = fixture('');
    binary.rs.sources[0]!.format = 'mrs'; binary.rs.sources[0]!.behavior = 'domain';
    expect(managedRuleDelivery(binary.rs, { client: 'stash' })).toMatchObject({ mode: 'managed', format: 'mrs', behavior: 'domain' });
  });

  it.each(['text', 'yaml'])('远程 %s 的 wildcard 大小写重复托管去重，唯一规则也托管', format => {
    const lines = ['PROCESS-PATH-WILDCARD,/Apps/*', 'PROCESS-PATH-WILDCARD,/apps/*'];
    const f = fixture(format === 'yaml' ? `payload: ${JSON.stringify(lines)}` : lines.join('\n'));
    expect(f.decide().mode).toBe('managed');
    const text = Object.values(rendered(f.inputs).rulesets)[0]!.text;
    expect(text.split('\n').filter(line => line && !line.startsWith('#'))).toEqual([lines[0]]);
    expect(text).toContain(`# [重复规则] ${lines[1]}`);
    expect(managedRuleDelivery(f.rs, { client: 'surge' }).mode).toBe('managed'); // Surge 需要翻译进程类型
    expect(fixture(lines[0]!).decide().mode).toBe('managed');
  });

  it.each([
    ['DOMAIN,example.com', 'classical', 'text', 'classical'],
    ['example.com\n+.example.net', 'domain-set', 'text', 'domain'],
    ['192.0.2.0/24\n2001:db8::/32', 'ipcidr', 'text', 'ipcidr'],
    ['payload: ["DOMAIN,example.com", "IP-CIDR,192.0.2.0/24"]', 'yaml', 'yaml', 'classical'],
    ['payload: [".example.com", "+.example.net"]', 'yaml', 'yaml', 'domain'],
    ['payload: ["192.0.2.0/24"]', 'yaml', 'yaml', 'ipcidr'],
  ])('自动识别 %s 并统一生成托管文本', (body, detected, format, behavior) => {
    const f = fixture(body);
    expect(parseRuleSourceContent(body, { format: 'ipcidr' })).toMatchObject({ format: detected, behavior });
    expect(f.decide()).toEqual({ mode: 'managed', format: 'text', behavior: 'classical' });
    const out = rendered(f.inputs);
    expect(Object.values(out.rulesets)).toHaveLength(1);
    expect(out.config['rule-providers']).toMatchObject({ 自动格式: { format: 'text', behavior: 'classical', url: 'https://sub.test/r/rs_r_classical.list' } });
  });

  it.each([
    { overrides: [{ match: 'DOMAIN,example.com', override: { when: { client: 'mihomo' as const }, action: { drop: true as const } } }] },
  ])('额外配置触发托管：%j', patch => {
    const f = fixture('DOMAIN,example.com', patch);
    expect(f.decide().mode).toBe('managed');
  });

  it('旧独立 no-resolve 不改变托管方式', () => {
    const f = fixture('IP-CIDR,192.0.2.0/24', { noResolve: true });
    expect(f.decide().mode).toBe('managed');
    expect(managedRuleDelivery(f.rs, { client: 'mihomo' }, { noResolve: true }).mode).toBe('managed');
  });

  it('合并本地与远程只输出一个 classical LIST，去重并保留行级 IP 选项', () => {
    const f = fixture('payload: ["DOMAIN,example.com", "IP-CIDR,192.0.2.0/24,no-resolve"]');
    f.rs.sources.push({ id: 'local', kind: 'local', format: 'yaml', content: 'DOMAIN,example.com\nIP-CIDR,198.51.100.0/24,src' });
    const out = rendered(f.inputs);
    expect(out.rulesets).toEqual({ 'rs_r_classical.list': { behavior: 'classical', providerName: '自动格式', text: 'DOMAIN,example.com\nIP-CIDR,192.0.2.0/24,no-resolve\n# [重复规则] DOMAIN,example.com\nIP-CIDR,198.51.100.0/24,src\n' } });
    expect(out.config['rule-providers']).toEqual({ 自动格式: { type: 'http', behavior: 'classical', format: 'text', interval: 86400, proxy: 'DIRECT', url: 'https://sub.test/r/rs_r_classical.list' } });
  });

  it('忽略停用来源，但规则级选项和旧来源覆写均使用托管', () => {
    const f = fixture('IP-CIDR,192.0.2.0/24');
    f.rs.sources.push({ id: 'off', enabled: false, kind: 'local', format: 'auto', content: 'DOMAIN,off.test' });
    expect(f.decide().mode).toBe('managed');
    expect(managedRuleDelivery(f.rs, { client: 'mihomo' }, { src: true }).mode).toBe('managed');
    f.rs.sources[0]!.overrides = [{ line: 1, override: { when: { client: 'surge' }, action: { drop: true } } }];
    expect(f.decide().mode).toBe('managed');
  });

  it.each(['.example.com', 'DEST-PORT,443', 'DOMAIN,example.com\nUNKNOWN,x', ';注释\nDOMAIN,example.com'])('需要转换的内容统一托管：%s', body => {
    expect(fixture(body).decide().mode).toBe('managed');
  });

  it('YAML 与 Clash 域名的前导点不扩大为根域，Surge DOMAIN-SET 保留根域', () => {
    const read = (body: string, format: 'auto' | 'domain') => parseRuleSourceContent(body, { format });
    expect(read('payload: [".example.com"]', 'auto')).toMatchObject({ rules: [{ rule: { type: 'DOMAIN-WILDCARD', value: '*.example.com' } }] });
    expect(read('.example.com', 'domain')).toMatchObject({ rules: [{ rule: { type: 'DOMAIN-WILDCARD', value: '*.example.com' } }] });
    expect(read('.example.com', 'auto')).toMatchObject({ rules: [{ rule: { type: 'DOMAIN-SUFFIX', value: 'example.com' } }] });
  });

  it('客户端不支持原格式时转换，旧二进制无法转换时明确失败', () => {
    const f = fixture('payload: ["DOMAIN,example.com"]');
    expect(managedRuleDelivery(f.rs, { client: 'surge' }).mode).toBe('managed');
    f.rs.sources[0] = { id: 's', kind: 'remote', format: 'mrs', behavior: 'domain', url: 'https://example.test/rules.mrs' };
    expect(f.decide()).toMatchObject({ mode: 'managed', format: 'mrs' });
    delete f.inputs.snapshots['r/s'];
    f.rs.noResolve = true;
    expect(f.decide().mode).toBe('managed');
    f.rs.overrides = [{ match: 'DOMAIN,example.test', override: { when: { client: 'mihomo' }, action: { drop: true } } }];
    expect(f.decide().mode).toBe('unsupported');
    expect(rendered(f.inputs).report.byCode('ruleset.conversion-unavailable')).toHaveLength(1);
  });
});
