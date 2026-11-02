import { describe, expect, it } from 'vitest';
import { applyOverrides, lowerRule, regexToWildcard } from '../src/rules/client.ts';
import { formatRuleLine } from '../src/rules/expand.ts';
import { parseRuleLine, parseRuleSetContent } from '../src/rules/parse.ts';
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
    if (r.binary) throw new Error('unexpected');
    expect(r.format).toBe('classical');
    expect(r.rules.map((x) => x.rule)).toMatchSnapshot();
    expect(r.rejected.map((x) => [x.line, x.reason])).toEqual([
      [13, '不支持的规则类型 UNKNOWN'],
    ]);
  });

  it('USER-AGENT 保留通配与大小写，按内核输出，文本往返不丢失', () => {
    const text = 'USER-AGENT,PayPal?*';
    const rule = parseRuleLine(text);
    expect(rule).toEqual({ type: 'USER-AGENT', value: 'PayPal?*' });
    expect(formatRuleLine(rule)).toBe(text);
    for (const client of ['surge', 'stash', 'loon'] as const) {
      expect(lowerRule(rule, { client })).toEqual({ kind: 'ok', text });
    }
    expect(lowerRule(rule, { client: 'mihomo' })).toEqual({ kind: 'drop', reason: 'mihomo 不支持 USER-AGENT' });
    expect(() => parseRuleLine('USER-AGENT,')).toThrow('缺少规则值');
  });

  it('自动识别 DOMAIN-SET、纯 CIDR、mihomo YAML payload', () => {
    const ds = parseRuleSetContent('.apple.com\nicloud.com\n');
    const ip = parseRuleSetContent('1.1.1.0/24\n2001:db8::/32\n');
    const yml = parseRuleSetContent("payload:\n  - '+.google.com'\n  - 'www.youtube.com'\n");
    const cls = parseRuleSetContent("payload:\n  - DOMAIN-SUFFIX,x.com\n  - IP-CIDR,1.0.0.0/8,no-resolve\n");
    const pick = (r: ReturnType<typeof parseRuleSetContent>) => (r.binary ? [] : r.rules.map((x) => x.rule));
    expect(pick(ds)).toEqual([{ type: 'DOMAIN-SUFFIX', value: 'apple.com' }, { type: 'DOMAIN', value: 'icloud.com' }]);
    expect(pick(ip)).toEqual([{ type: 'IP-CIDR', value: '1.1.1.0/24' }, { type: 'IP-CIDR6', value: '2001:db8::/32' }]);
    expect(pick(yml)).toEqual([{ type: 'DOMAIN-SUFFIX', value: 'google.com' }, { type: 'DOMAIN', value: 'www.youtube.com' }]);
    expect(pick(cls)).toEqual([{ type: 'DOMAIN-SUFFIX', value: 'x.com' }, { type: 'IP-CIDR', value: '1.0.0.0/8', noResolve: true }]);
  });

  it('带引号或流式 YAML payload 自动转换，不能作为二进制托管', () => {
    for (const body of ['"payload": ["+.example.com"]', '{payload: ["+.example.com"]}']) {
      const parsed = parseRuleSetContent(body);
      expect(parsed).toMatchObject({ binary: false, conversion: 'yaml-to-list', rules: [{ rule: { type: 'DOMAIN-SUFFIX', value: 'example.com' } }] });
      expect(() => parseRuleSetContent(body, 'mrs')).toThrow('不能标记为二进制');
    }
  });

  it('mrs / srs 识别为二进制，不解析文本', () => {
    expect(parseRuleSetContent('', 'mrs')).toEqual({ binary: true, format: 'mrs' });
  });
});

describe('PRD 场景 6：进程规则分客户端', () => {
  const rule = parseRuleLine('PROCESS-PATH-WILDCARD,/Applications/*/WeChat.app/*');

  it('mihomo 输出 PROCESS-PATH-WILDCARD', () => {
    expect(lowerRule(rule, { client: 'mihomo' })).toEqual({ kind: 'ok', text: 'PROCESS-PATH-WILDCARD,/Applications/*/WeChat.app/*' });
  });
  it('Surge 公共输出保留进程规则，由客户端判断平台能力', () => {
    expect(lowerRule(rule, { client: 'surge' })).toEqual({ kind: 'ok', text: 'PROCESS-NAME,/Applications/*/WeChat.app/*' });
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
    expect(lowerRule(r, { client: 'surge' })).toMatchObject({ kind: 'ok', text: 'PROCESS-NAME,steam*' });
  });

  it('Surge 写法差异', () => {
    const s = (t: string) => lowerRule(parseRuleLine(t), { client: 'surge' });
    expect(s('DST-PORT,22')).toEqual({ kind: 'ok', text: 'DEST-PORT,22' });
    expect(s('NETWORK,udp')).toEqual({ kind: 'ok', text: 'PROTOCOL,UDP' });
    expect(s('GEOSITE,cn').kind).toBe('drop');
    expect(s('DOMAIN-REGEX,^a\\.com$').kind).toBe('drop');
  });

  it('按内核改写进程名称，不影响其他内核', () => {
    const rule: RuleIR = { type: 'PROCESS', kind: 'name', mode: 'exact', value: 'Telegram' };
    const ov = [{ when: { client: 'mihomo' as const }, action: { replace: [{ ...rule, value: 'org.telegram.messenger' }] } }];
    expect(applyOverrides(rule, ov, { client: 'mihomo' })).toEqual([{ ...rule, value: 'org.telegram.messenger' }]);
    expect(applyOverrides(rule, ov, { client: 'surge' })).toEqual([rule]);
    expect(applyOverrides(rule, [{ when: { client: 'surge' }, action: { drop: true } }], { client: 'surge' })).toEqual([]);
    expect(applyOverrides(rule, [{ when: { client: 'surge' }, action: { append: [{ type: 'DOMAIN', value: 'added.test' }] } }], { client: 'surge' })).toEqual([rule, { type: 'DOMAIN', value: 'added.test' }]);
  });
});

describe('历史规则文本格式化', () => {
  it('单条规则写回 classical 文本', () => {
    expect(formatRuleLine({ type: 'IP-CIDR', value: '10.0.0.0/8', noResolve: true })).toBe('IP-CIDR,10.0.0.0/8,no-resolve');
    expect(formatRuleLine({ type: 'PROCESS', kind: 'name', mode: 'regex', value: '^code$' })).toBe('PROCESS-NAME-REGEX,^code$');
    expect(formatRuleLine({ type: 'RAW', client: 'surge', text: 'USER-AGENT,x*' })).toBe('USER-AGENT,x*');
  });
});
