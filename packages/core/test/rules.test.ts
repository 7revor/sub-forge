import { describe, expect, it } from 'vitest';
import { applyOverrides, lowerRule, regexToWildcard } from '../src/rules/client.ts';
import { expandRuleSet, formatRuleLine, sourceKey, type RuleSetInputs } from '../src/rules/expand.ts';
import { parseRuleLine, parseRuleSetContent } from '../src/rules/parse.ts';
import { Report } from '../src/report.ts';
import type { RuleIR } from '../src/types.ts';

describe('规则解析', () => {
  it('classical 文本：统一 mihomo 与 Surge 写法，记录不支持的行', () => {
    const text = `# comment
DOMAIN-SUFFIX,notion.so
IP-CIDR,91.108.4.0/22,no-resolve
IP-CIDR,2001:b28:f23d::/48
DEST-PORT,22
PROTOCOL,UDP
SRC-IP,192.168.1.0/24
PROCESS-NAME,Notion
PROCESS-NAME,/Applications/*/Slack.app/*
PROCESS-PATH-WILDCARD,/usr/bin/*
PROCESS-NAME-REGEX,(?i)^code$
IP-ASN,AS62041
USER-AGENT,Notion*
AND,((DOMAIN,a.com),(DST-PORT,443))`;
    const r = parseRuleSetContent(text);
    if (r.passthrough) throw new Error('unexpected');
    expect(r.format).toBe('classical');
    expect(r.rules.map((x) => x.rule)).toMatchSnapshot();
    expect(r.rejected.map((x) => [x.line, x.reason])).toEqual([
      [13, '不支持的规则类型 USER-AGENT'],
      [14, '逻辑规则暂不支持（RS-04，P1）'],
    ]);
  });

  it('自动识别 DOMAIN-SET、纯 CIDR、mihomo YAML payload', () => {
    const ds = parseRuleSetContent('.apple.com\nicloud.com\n');
    const ip = parseRuleSetContent('1.1.1.0/24\n2001:db8::/32\n');
    const yml = parseRuleSetContent("payload:\n  - '+.google.com'\n  - 'www.youtube.com'\n");
    const cls = parseRuleSetContent("payload:\n  - DOMAIN-SUFFIX,x.com\n  - IP-CIDR,1.0.0.0/8,no-resolve\n");
    const pick = (r: ReturnType<typeof parseRuleSetContent>) => (r.passthrough ? [] : r.rules.map((x) => x.rule));
    expect(pick(ds)).toEqual([{ type: 'DOMAIN-SUFFIX', value: 'apple.com' }, { type: 'DOMAIN', value: 'icloud.com' }]);
    expect(pick(ip)).toEqual([{ type: 'IP-CIDR', value: '1.1.1.0/24' }, { type: 'IP-CIDR6', value: '2001:db8::/32' }]);
    expect(pick(yml)).toEqual([{ type: 'DOMAIN-SUFFIX', value: 'google.com' }, { type: 'DOMAIN', value: 'www.youtube.com' }]);
    expect(pick(cls)).toEqual([{ type: 'DOMAIN-SUFFIX', value: 'x.com' }, { type: 'IP-CIDR', value: '1.0.0.0/8', noResolve: true }]);
  });

  it('mrs / srs 透传不解析', () => {
    expect(parseRuleSetContent('', 'mrs')).toEqual({ passthrough: true, format: 'mrs' });
  });
});

describe('PRD 场景 6：进程规则分客户端', () => {
  const rule = parseRuleLine('PROCESS-PATH-WILDCARD,/Applications/*/WeChat.app/*');

  it('mihomo 输出 PROCESS-PATH-WILDCARD', () => {
    expect(lowerRule(rule, { client: 'mihomo' })).toEqual({ kind: 'ok', text: 'PROCESS-PATH-WILDCARD,/Applications/*/WeChat.app/*' });
  });
  it('Surge macOS 输出 PROCESS-NAME', () => {
    expect(lowerRule(rule, { client: 'surge', platform: 'macos' })).toEqual({ kind: 'ok', text: 'PROCESS-NAME,/Applications/*/WeChat.app/*' });
  });
  it('Surge iOS 丢弃并说明原因', () => {
    expect(lowerRule(rule, { client: 'surge', platform: 'ios' })).toEqual({ kind: 'drop', reason: 'Surge iOS 不支持进程规则' });
  });
});

describe('客户端降级与覆盖', () => {
  it('进程正则尽量转为通配', () => {
    expect(regexToWildcard('^steam.*')).toBe('steam*');
    expect(regexToWildcard('code')).toBe('*code*');
    expect(regexToWildcard('^Code\\ Helper$')).toBe('Code Helper');
    expect(regexToWildcard('^code(-insiders)?$')).toBeUndefined();
    expect(regexToWildcard('(?i)^code$')).toBeUndefined();
    const r: RuleIR = { type: 'PROCESS', kind: 'name', mode: 'regex', value: '^steam.*' };
    expect(lowerRule(r, { client: 'surge', platform: 'macos' })).toMatchObject({ kind: 'ok', text: 'PROCESS-NAME,steam*' });
  });

  it('Surge 写法差异', () => {
    const s = (t: string) => lowerRule(parseRuleLine(t), { client: 'surge', platform: 'macos' });
    expect(s('DST-PORT,22')).toEqual({ kind: 'ok', text: 'DEST-PORT,22' });
    expect(s('NETWORK,udp')).toEqual({ kind: 'ok', text: 'PROTOCOL,UDP' });
    expect(s('GEOSITE,cn').kind).toBe('drop');
    expect(s('DOMAIN-REGEX,^a\\.com$').kind).toBe('drop');
  });

  it('按客户端与平台覆盖（Android 包名）', () => {
    const rule: RuleIR = { type: 'PROCESS', kind: 'name', mode: 'exact', value: 'Telegram' };
    const ov = [{ when: { client: 'mihomo' as const, platform: 'android' as const }, action: { replace: [{ ...rule, value: 'org.telegram.messenger' }] } }];
    expect(applyOverrides(rule, ov, { client: 'mihomo', platform: 'android' })).toEqual([{ ...rule, value: 'org.telegram.messenger' }]);
    expect(applyOverrides(rule, ov, { client: 'mihomo', platform: 'windows' })).toEqual([rule]);
    expect(applyOverrides(rule, [{ when: { client: 'surge' }, action: { drop: true } }], { client: 'surge', platform: 'ios' })).toEqual([]);
  });
});

describe('规则集多来源', () => {
  const inputs: RuleSetInputs = {
    rulesets: {
      fin: { id: 'fin', name: '金融服务', noResolve: true, sources: [
        { id: 'paypal', kind: 'local', format: 'auto', content: 'DOMAIN-SUFFIX,paypal.com\nDOMAIN-KEYWORD,paypal\nIP-CIDR,64.4.240.0/21' },
        { id: 'stripe', kind: 'local', format: 'auto', content: '.stripe.com\npaypal.com' },
        { id: 'broker', name: '券商', kind: 'remote', format: 'mrs', behavior: 'ipcidr', url: 'https://example.com/broker.mrs' },
        { id: 'off', kind: 'local', format: 'auto', content: 'DOMAIN,off.example.com', enabled: false },
        { id: 'single', kind: 'local', format: 'classical', content: 'DOMAIN-SUFFIX,paypal.com',
          overrides: [{ line: 1, override: { when: { client: 'surge' }, action: { drop: true } } }] },
        { id: 'remote', kind: 'remote', format: 'auto', url: 'https://example.com/r.list' },
      ] },
    },
    snapshots: { [sourceKey('fin', 'remote')]: 'DOMAIN,remote.example.com' },
  };

  it('按 behavior 拆分、去重、IP 类统一 no-resolve、mrs 透传、读远程快照', () => {
    const report = new Report();
    const b = expandRuleSet('fin', inputs, { client: 'mihomo' }, report);
    expect(b.domain).toEqual([{ type: 'DOMAIN-SUFFIX', value: 'paypal.com' }, { type: 'DOMAIN-SUFFIX', value: 'stripe.com' }, { type: 'DOMAIN', value: 'paypal.com' }, { type: 'DOMAIN', value: 'remote.example.com' }]);
    expect(b.classical).toEqual([{ type: 'DOMAIN-KEYWORD', value: 'paypal' }]);
    expect(b.ipcidr).toEqual([{ type: 'IP-CIDR', value: '64.4.240.0/21', noResolve: true }]);
    expect(b.passthrough).toEqual([{ sourceId: 'broker', name: '券商', format: 'mrs', url: 'https://example.com/broker.mrs', behavior: 'ipcidr' }]);
    expect(b).toMatchObject({ total: 7, duplicates: 1 });
    expect(report.items).toEqual([]);
  });

  it('行级覆盖只作用于所在来源', () => {
    const b = expandRuleSet('fin', inputs, { client: 'surge' }, new Report());
    expect(b.total).toBe(6);
    expect(b.duplicates).toBe(0);
  });

  it('远程来源没有快照时报错并指明来源', () => {
    const report = new Report();
    expandRuleSet('fin', { ...inputs, snapshots: {} }, { client: 'mihomo' }, report);
    expect(report.items).toMatchObject([{ code: 'ruleset.no-snapshot', message: '规则集「金融服务」的来源「https://example.com/r.list」没有可用快照' }]);
  });

  it('单条规则写回 classical 文本', () => {
    expect(formatRuleLine({ type: 'IP-CIDR', value: '10.0.0.0/8', noResolve: true })).toBe('IP-CIDR,10.0.0.0/8,no-resolve');
    expect(formatRuleLine({ type: 'PROCESS', kind: 'name', mode: 'regex', value: '^code$' })).toBe('PROCESS-NAME-REGEX,^code$');
    expect(formatRuleLine({ type: 'RAW', client: 'surge', text: 'USER-AGENT,x*' })).toBe('USER-AGENT,x*');
  });
});
