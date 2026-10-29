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
UNKNOWN,Notion*
AND,((DOMAIN,a.com),(DST-PORT,443))`;
    const r = parseRuleSetContent(text);
    if (r.passthrough) throw new Error('unexpected');
    expect(r.format).toBe('classical');
    expect(r.rules.map((x) => x.rule)).toMatchSnapshot();
    expect(r.rejected.map((x) => [x.line, x.reason])).toEqual([
      [13, '不支持的规则类型 UNKNOWN'],
      [14, '逻辑规则暂不支持（RS-04，P1）'],
    ]);
  });

  it('USER-AGENT 保留通配与大小写，只在 Surge 输出，文本往返不丢失', () => {
    const text = 'USER-AGENT,PayPal?*';
    const rule = parseRuleLine(text);
    expect(rule).toEqual({ type: 'USER-AGENT', value: 'PayPal?*' });
    expect(formatRuleLine(rule)).toBe(text);
    for (const platform of ['macos', 'ios'] as const) {
      expect(lowerRule(rule, { client: 'surge', platform })).toEqual({ kind: 'ok', text });
    }
    for (const platform of [undefined, 'android'] as const) {
      expect(lowerRule(rule, { client: 'mihomo', platform })).toEqual({ kind: 'drop', reason: 'mihomo 不支持 USER-AGENT' });
    }
    expect(() => parseRuleLine('USER-AGENT,')).toThrow('缺少规则值');
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

  it('带引号或流式 YAML payload 自动转换，不能作为二进制透传', () => {
    for (const body of ['"payload": ["+.example.com"]', '{payload: ["+.example.com"]}']) {
      const parsed = parseRuleSetContent(body);
      expect(parsed).toMatchObject({ passthrough: false, conversion: 'yaml-to-list', rules: [{ rule: { type: 'DOMAIN-SUFFIX', value: 'example.com' } }] });
      expect(() => parseRuleSetContent(body, 'mrs')).toThrow('不能透传');
    }
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
    expect(applyOverrides(rule, [{ when: { client: 'surge' }, action: { append: [{ type: 'DOMAIN', value: 'added.test' }] } }], { client: 'surge' })).toEqual([rule, { type: 'DOMAIN', value: 'added.test' }]);
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

  it('按 behavior 拆分、去重、忽略旧 no-resolve 开关、mrs 透传、读远程快照', () => {
    const report = new Report();
    const b = expandRuleSet('fin', inputs, { client: 'mihomo' }, report);
    expect(b.domain).toEqual([{ type: 'DOMAIN-SUFFIX', value: 'paypal.com' }, { type: 'DOMAIN-SUFFIX', value: 'stripe.com' }, { type: 'DOMAIN', value: 'paypal.com' }, { type: 'DOMAIN', value: 'remote.example.com' }]);
    expect(b.classical).toEqual([{ type: 'DOMAIN-KEYWORD', value: 'paypal' }]);
    expect(b.ipcidr).toEqual([{ type: 'IP-CIDR', value: '64.4.240.0/21' }]);
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

describe('规则集组级内容改写', () => {
  const make = (): RuleSetInputs => ({ rulesets: { r: {
    id: 'r', name: '整组', noResolve: true,
    sources: [
      { id: 'a', kind: 'local', format: 'classical', content: '# 注释\nDOMAIN,same.test\nDOMAIN,keep.test' },
      { id: 'b', kind: 'remote', format: 'classical', url: 'https://example.test/list' },
      { id: 'off', kind: 'local', format: 'classical', content: 'DOMAIN,off.test', enabled: false },
      { id: 'binary', kind: 'remote', format: 'mrs', behavior: 'domain', url: 'https://example.test/binary' },
    ],
    overrides: [
      { match: 'DOMAIN,same.test', override: { when: { client: 'mihomo', platform: 'android' }, action: { replace: [{ type: 'IP-CIDR', value: '192.0.2.0/24' }] } } },
      { match: 'DOMAIN,same.test', override: { when: { client: 'mihomo' }, action: { drop: true } } },
    ],
  } }, snapshots: { 'r/b': 'DOMAIN,same.test\nDOMAIN,remote.test' } });

  it('所有来源按内容匹配，平台优先级、替换后去重、忽略独立 no-resolve 且保留二进制透传', () => {
    const b = expandRuleSet('r', make(), { client: 'mihomo', platform: 'android' }, new Report());
    expect(b.domain.map((r) => 'value' in r && r.value)).toEqual(['keep.test', 'remote.test']);
    expect(b.ipcidr).toEqual([{ type: 'IP-CIDR', value: '192.0.2.0/24' }]);
    expect(b).toMatchObject({ total: 4, duplicates: 1, passthrough: [{ sourceId: 'binary' }] });
  });

  it('丢弃整组所有匹配项，其他客户端与不匹配内容保持原样', () => {
    const inputs = make();
    expect(expandRuleSet('r', inputs, { client: 'mihomo' }, new Report()).domain).toEqual([
      { type: 'DOMAIN', value: 'keep.test' }, { type: 'DOMAIN', value: 'remote.test' },
    ]);
    expect(expandRuleSet('r', inputs, { client: 'surge' }, new Report()).domain).toHaveLength(3);
    inputs.rulesets.r!.sources.reverse();
    expect(expandRuleSet('r', inputs, { client: 'mihomo', platform: 'android' }, new Report()).ipcidr).toHaveLength(1);
  });
});

describe('规则集条件追加', () => {
  it('mihomo 展开按 wildcard 小写键跨来源及追加去重，Surge 保留大小写差异', () => {
    const inputs: RuleSetInputs = { rulesets: { r: { id: 'r', name: '', sources: [
      { id: 'a', kind: 'local', format: 'auto', content: 'PROCESS-PATH-WILDCARD,/Apps/*\nPROCESS-NAME-WILDCARD,App*' },
      { id: 'b', kind: 'local', format: 'auto', content: 'PROCESS-PATH-WILDCARD,/apps/*\nPROCESS-NAME-WILDCARD,app*' },
    ], overrides: [{ override: { when: { client: 'mihomo' }, action: { append: [{ type: 'PROCESS', kind: 'path', mode: 'wildcard', value: '/APPS/*' }] } } }] } }, snapshots: {} };
    const result = expandRuleSet('r', inputs, { client: 'mihomo' }, new Report());
    expect(result).toMatchObject({ total: 5, duplicates: 3 });
    expect(result.classical).toEqual([
      { type: 'PROCESS', kind: 'path', mode: 'wildcard', value: '/Apps/*' },
      { type: 'PROCESS', kind: 'name', mode: 'wildcard', value: 'App*' },
    ]);
    expect(expandRuleSet('r', inputs, { client: 'surge' }, new Report())).toMatchObject({ total: 4, duplicates: 0 });
  });

  it('多来源只追加一次，遵循客户端与平台条件、去重并忽略旧 no-resolve', () => {
    const inputs: RuleSetInputs = { rulesets: { r: {
      id: 'r', name: '追加', noResolve: true,
      sources: ['a', 'b'].map((id) => ({ id, kind: 'local', format: 'auto', content: 'DOMAIN,keep.test' })),
      overrides: [
        { override: { when: { client: 'surge', platform: 'macos' }, action: { append: [
          { type: 'DOMAIN', value: 'added.test' }, { type: 'DOMAIN', value: 'keep.test' },
          { type: 'IP-CIDR', value: '192.0.2.0/24' },
        ] } } },
        { override: { when: { client: 'surge' }, action: { append: [{ type: 'DOMAIN', value: 'second.test' }] } } },
        { match: 'DOMAIN,added.test', override: { when: { client: 'surge' }, action: { drop: true } } },
      ],
    } }, snapshots: {} };
    const mac = expandRuleSet('r', inputs, { client: 'surge', platform: 'macos' }, new Report());
    expect(mac.domain).toEqual(['keep.test', 'added.test', 'second.test'].map((value) => ({ type: 'DOMAIN', value })));
    expect(mac.ipcidr).toEqual([{ type: 'IP-CIDR', value: '192.0.2.0/24' }]);
    expect(mac).toMatchObject({ total: 6, duplicates: 2 });
    expect(expandRuleSet('r', inputs, { client: 'surge', platform: 'ios' }, new Report()).domain).toHaveLength(2);
    expect(expandRuleSet('r', inputs, { client: 'mihomo' }, new Report()).domain).toHaveLength(1);
    inputs.rulesets.r!.sources.forEach((s) => { s.enabled = false; });
    expect(expandRuleSet('r', inputs, { client: 'surge', platform: 'macos' }, new Report()).domain).toHaveLength(3);
  });
});
