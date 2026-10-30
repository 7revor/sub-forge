import { validateTemplate, type RuleEntry } from '@sub-forge/core';
import { describe, expect, it, vi } from 'vitest';
import { parse, stringify } from 'yaml';
import { newId, templateFormFromYaml, templateFromYaml, templateToYaml, type ConvertCtx, type TemplateBody } from './templateYaml';

const ctx: ConvertCtx = {
  rulesets: [{ id: 'rs_ads', name: '广告规则' }, { id: 'b_media', name: '媒体规则包' }],
};
const direct = { kind: 'builtin', name: 'DIRECT' } as const;
const proxy = { kind: 'group', groupId: 'g_select' } as const;
const empty: TemplateBody = { groups: [], rules: [], final: direct };

function fixture(): TemplateBody {
  return {
    groups: [
      {
        id: 'g_select', name: '代理选择', type: 'select', whenEmpty: 'reject', hint: '选择出口',
        members: [{ kind: 'group', groupId: 'g_url' }, { kind: 'group', groupId: 'g_fallback' }, { kind: 'group', groupId: 'g_balance' }, direct],
        display: { hidden: false, icon: 'https://example.com/icon.png' },
        extra: { 'interface-name': 'en0', 'routing-mark': 42, extension: { nested: ['保留', 7] } },
      },
      {
        id: 'g_url', name: '自动测速', type: 'url-test', members: [{ kind: 'builtin', name: 'REJECT' }],
        test: { url: 'https://example.com/204', interval: 300, timeout: 5000, tolerance: 50, lazy: false, maxFailedTimes: 3, expectedStatus: '204' },
        display: { hidden: true }, whenEmpty: 'direct', hint: '建议香港节点',
      },
      { id: 'g_fallback', name: '故障切换', type: 'fallback', members: [{ kind: 'builtin', name: 'REJECT-DROP' }, { kind: 'builtin', name: 'PASS' }], test: { interval: 120, lazy: true } },
      { id: 'g_balance', name: '负载均衡', type: 'load-balance', members: [], strategy: 'consistent-hashing', test: { url: 'https://example.com', timeout: 2000 } },
    ],
    rules: [
      { id: 'r_disabled_first', matcher: { kind: 'rule', rule: { type: 'DOMAIN', value: 'disabled.example' } }, target: direct },
      { id: 'r_domain', matcher: { kind: 'rule', rule: { type: 'DOMAIN-SUFFIX', value: 'example.com' }, overrides: [{ when: { client: 'surge' }, action: { drop: true } }] }, target: proxy },
      { id: 'r_ir', matcher: { kind: 'rule', rule: { type: 'IP-CIDR', value: '10.0.0.0/8', noResolve: true } }, target: direct },
      { id: 'r_options', matcher: { kind: 'rule', rule: { type: 'GEOIP', value: 'CN', noResolve: true } }, target: direct, options: { src: true } },
      { id: 'r_process', matcher: { kind: 'rule', rule: { type: 'PROCESS', kind: 'path', mode: 'wildcard', value: '/Applications/*' } }, target: proxy },
      { id: 'r_ruleset', matcher: { kind: 'ruleset', id: 'rs_ads' }, target: { kind: 'builtin', name: 'REJECT' } },
      { id: 'r_bundle', matcher: { kind: 'ruleset', id: 'b_media' }, target: proxy },
    ],
    final: proxy,
  };
}

function imported(text: string, current = empty, context = ctx) {
  const result = templateFromYaml(text, current, context);
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe('模板与 mihomo YAML 双向转换', () => {
  it.each([
    'IN-TYPE,SOCKS/HTTP', 'AND,((DOMAIN,a.test),(NETWORK,tcp))',
    'DOMAIN-REGEX,^(a, b)$', 'IP-SUFFIX,8.8.8.8/24,no-resolve,src',
  ])('RAW 表单与 YAML 往返保留原文、稳定 ID、出口和选项：%s', text => {
    const body: TemplateBody = { ...empty, rules: [{ id: 'raw', matcher: { kind: 'rule', rule: { type: 'RAW', text } }, target: direct }] };
    const yaml = templateToYaml(body, ctx);
    const output = parse(yaml).rules[0] as string;
    if (text.endsWith(',no-resolve,src')) expect(output).toBe('IP-SUFFIX,8.8.8.8/24,DIRECT,no-resolve,src');
    else expect(output).toBe(`${text},DIRECT`);
    expect(imported(yaml, body).value.rules[0]).toEqual(body.rules[0]);
    const changed = imported(yaml.replace(',DIRECT', ',REJECT'), body).value.rules[0]!;
    expect(changed.id).toBe('raw');
    expect(changed.matcher).toEqual(body.rules[0]!.matcher);
    expect(changed.target).toEqual({ kind: 'builtin', name: 'REJECT' });
  });
  it('未知单条语法从 YAML 导入为 RAW，不因现有类型枚举而丢弃', () => {
    const result = imported('rules: ["IN-TYPE,SOCKS/HTTP,DIRECT", "AND,((DOMAIN,a.test),(NETWORK,tcp)),DIRECT", "MATCH,DIRECT"]');
    expect(result.value.rules.map(rule => rule.matcher)).toEqual([
      { kind: 'rule', rule: { type: 'RAW', text: 'IN-TYPE,SOCKS/HTTP' } },
      { kind: 'rule', rule: { type: 'AND', children: [{ type: 'DOMAIN', value: 'a.test' }, { type: 'NETWORK', value: 'tcp' }] } },
    ]);
  });
  it('空组行为固定，原始配置不再保留可覆盖的 empty-fallback', () => {
    const body = fixture();
    body.groups[0]!.extra = { ...body.groups[0]!.extra, 'empty-fallback': 'DIRECT' };
    const text = templateToYaml(body, ctx);
    expect(text).not.toContain('empty-fallback');
    const result = imported(text.replace('type: select', 'type: select\n    empty-fallback: DIRECT'), body);
    expect(result.value.groups[0]!.extra).not.toHaveProperty('empty-fallback');
  });
  it('仓库与重名本地引用可独立导出导入，改出口和选项不丢失文件映射', () => {
    const repository = { repo: 'github', entry: 'Google', name: '仓库 · Google', sources: [{ id: 's', kind: 'remote' as const, format: 'auto' as const, url: 'https://example.test/Google.list', repository: { repo: 'github', entry: 'Google', ref: 'main', path: 'Google.list' } }] };
    const context = { rulesets: [{ id: 'one', name: 'Google' }, { id: 'two', name: 'Google' }] };
    const body: TemplateBody = { ...empty, rules: [
      { id: 'repo-rule', matcher: { kind: 'ruleset', id: 'repo:fixed', repository }, target: direct },
      { id: 'local-one', matcher: { kind: 'ruleset', id: 'one' }, target: direct },
      { id: 'local-two', matcher: { kind: 'ruleset', id: 'two' }, target: direct },
    ] };
    const yaml = templateToYaml(body, context);
    expect(yaml).toContain('RULE-SET,local:one,DIRECT');
    expect(yaml).toContain('RULE-SET,local:two,DIRECT');
    const fresh = imported(yaml, empty, context).value;
    expect(fresh.rules.map(r => r.matcher)).toEqual(body.rules.map(r => r.matcher));
    expect(fresh.rules[0]!.enabled).toBeUndefined();
    const changed = imported(yaml.replace('RULE-SET,repo:fixed,DIRECT', 'RULE-SET,repo:fixed,REJECT,no-resolve'), body, context).value;
    expect(changed.rules[0]!.options?.noResolve).toBeUndefined();
    expect(changed.rules[0]).toMatchObject({ id: 'repo-rule', matcher: body.rules[0]!.matcher, target: { kind: 'builtin', name: 'REJECT' } });
    const tampered = imported(yaml.replace('https://example.test/Google.list', 'https://example.test/changed.list'), body, context).value;
    expect(tampered.rules[0]!.matcher).toMatchObject({ repository: { sources: [{ url: 'https://example.test/changed.list' }] } });
    const ambiguous = templateFromYaml('rules: ["RULE-SET,Google,DIRECT"]', empty, context);
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) expect(ambiguous.error).toContain('重名');
  });

  it('本地规则集改名后按导出的 ID 恢复，不跟随显示名称重新匹配', () => {
    const body: TemplateBody = { ...empty, rules: [{ id: 'r', matcher: { kind: 'ruleset', id: 'rs' }, target: direct }] };
    const yaml = templateToYaml(body, { rulesets: [{ id: 'rs', name: '旧名称' }] });
    expect(imported(yaml, empty, { rulesets: [{ id: 'rs', name: '新名称' }, { id: 'other', name: '旧名称' }] }).value.rules[0]!.matcher).toEqual({ kind: 'ruleset', id: 'rs' });
  });

  it('恢复正常模板时仍保留稳定 ID 和覆盖', () => {
    const body = fixture();
    expect(templateFormFromYaml(templateToYaml(body, ctx), body, ctx)).toEqual({ value: body, notes: [] });
  });

  it('返回表单按字段清理策略组，并跳过坏规则、保留其他规则的身份', () => {
    const body = fixture();
    const yaml = templateToYaml(body, ctx).replace('interval: 300', 'interval: wrong')
      .replace('hidden: true', 'hidden: wrong').replace('DOMAIN,disabled.example,DIRECT', 'DOMAIN,,DIRECT')
      .replace('自动测速', '新的测速组').replaceAll('自动测速', '新的测速组');
    const result = templateFormFromYaml(yaml, body, ctx);
    expect(result.value.groups[1]).toMatchObject({ id: 'g_url', name: '新的测速组', test: { timeout: 5000 }, display: {} });
    expect(result.value.groups[1]!.test).not.toHaveProperty('interval');
    expect(result.value.groups[1]!.display).not.toHaveProperty('hidden');
    expect(result.value.rules.map((rule) => rule.id)).toEqual(body.rules.slice(1).map((rule) => rule.id));
    expect(result.value.rules[0]!.enabled).toBeUndefined();
    for (const key of ['interval', 'hidden', '缺少规则值']) expect(result.notes.join()).toContain(key);
  });

  it('组必填项和列表内容错误也能返回表单，保留可编辑字段', () => {
    const result = templateFormFromYaml('proxy-groups:\n  - {name: 123, type: wrong, icon: good.png, strategy: [round-robin], proxies: [DIRECT, 123]}\nrules: [123, "DOMAIN,example.com,DIRECT", "MATCH,REJECT"]', empty, ctx);
    expect(result.value.groups[0]).toMatchObject({ name: '', type: 'select', display: { icon: 'good.png' }, members: [direct] });
    expect(result.value.groups[0]).not.toHaveProperty('strategy');
    expect(result.value.rules).toHaveLength(1);
    expect(result.value.final).toEqual({ kind: 'builtin', name: 'REJECT' });
    expect(result.notes.length).toBeGreaterThanOrEqual(4);
  });

  it('语法错误不影响其他字段，失去出口组时明确恢复为 REJECT', () => {
    const body = fixture();
    const result = templateFormFromYaml('proxy-groups: [\nrules:\n  - DOMAIN,example.com,DIRECT\n', body, ctx);
    expect(result.value.groups).toEqual([]);
    expect(result.value.rules).toHaveLength(1);
    expect(result.value.final).toEqual({ kind: 'builtin', name: 'REJECT' });
    expect(result.notes.join()).toContain('原出口组已不存在');
  });
  it('完整模板往返后深度相等，保留 ID 和非 YAML 字段', () => {
    const t = fixture();
    const snapshot = structuredClone(t);
    const yaml = templateToYaml(t, ctx);
    expect(yaml).toContain('proxies: []');
    expect(yaml).toContain('PROCESS-PATH-WILDCARD,/Applications/*,代理选择');
    expect(yaml).toContain('GEOIP,CN,DIRECT,no-resolve,src');
    expect(yaml).toContain('RULE-SET,广告规则,REJECT');
    expect(yaml).toContain('RULE-SET,媒体规则包,代理选择');
    expect(yaml).not.toContain('RULE-SET,媒体规则包,代理选择,no-resolve');
    expect(yaml).not.toContain('# disabled');
    expect(yaml).not.toMatch(/whenEmpty|hint/);
    const result = imported(yaml, t);
    expect(result.value).toStrictEqual(t);
    expect(result.notes).toEqual([]);
    expect(t).toStrictEqual(snapshot);
    expect(validateTemplate({ id: 't', version: 1, ...result.value }).hasErrors).toBe(false);
  });

  it('在导出的 YAML 中改名保留稳定 ID、成员、覆盖提示和规则引用', () => {
    const t = fixture();
    t.rules.push({ id: 'r_renamed', matcher: { kind: 'rule', rule: { type: 'DOMAIN', value: 'rename.example' } }, target: { kind: 'group', groupId: 'g_url' } });
    const result = imported(templateToYaml(t, ctx).replaceAll('自动测速', '新的测速组'), t).value;
    const renamed = result.groups[1]!;
    expect(renamed.name).toBe('新的测速组');
    expect(renamed.id).toBe('g_url');
    expect(renamed.whenEmpty).toBe('direct');
    expect(renamed.hint).toBe('建议香港节点');
    expect(result.groups[0]!.members[0]).toEqual({ kind: 'group', groupId: renamed.id });
    expect(result.rules.at(-1)).toMatchObject({ id: 'r_renamed', target: { kind: 'group', groupId: renamed.id } });
    expect(result.groups[0]!.id).toBe(t.groups[0]!.id);
  });

  it('编辑规则匹配内容保留 ID，但不会恢复旧的匹配内容', () => {
    const t = fixture();
    const result = imported(templateToYaml(t, ctx).replace('DOMAIN-SUFFIX,example.com', 'DOMAIN-SUFFIX,new.example.com'), t).value;
    expect(result.rules.find(r => r.id === 'r_domain')!.matcher).toEqual({ kind: 'rule', rule: { type: 'DOMAIN-SUFFIX', value: 'new.example.com' }, overrides: t.rules[1]!.matcher.kind === 'rule' ? t.rules[1]!.matcher.overrides : undefined });
  });

  it('复制稳定 ID 注释不会生成两个同 ID 的组', () => {
    const t: TemplateBody = { groups: [{ id: 'g1', name: '甲', type: 'select', members: [] }], rules: [], final: direct };
    const yaml = 'proxy-groups:\n  # sub-forge-group: g1\n  - { name: 甲, type: select }\n  # sub-forge-group: g1\n  - { name: 乙, type: select }\nrules: [MATCH,DIRECT]';
    expect(templateFromYaml(yaml, t, ctx)).toMatchObject({ ok: false, error: expect.stringContaining('重复使用同一个稳定 ID') });
  });

  it('只调整规则顺序或出口时复用 ID，重复匹配项依次消费旧 ID', () => {
    const a: RuleEntry = { id: 'r_a', matcher: { kind: 'rule', rule: { type: 'DOMAIN', value: 'a.example' } }, target: direct };
    const b: RuleEntry = { id: 'r_b', matcher: { kind: 'rule', rule: { type: 'PROCESS', kind: 'name', mode: 'exact', value: 'curl' } }, target: direct };
    const t: TemplateBody = { ...empty, rules: [a, b, { ...a, id: 'r_a2' }] };
    const yaml = 'rules:\n  - PROCESS-NAME,curl,REJECT\n  - DOMAIN,a.example,PASS\n  - DOMAIN,a.example,REJECT\n  - DOMAIN,a.example,DIRECT\n  - MATCH,DIRECT\n';
    const result = imported(yaml, t).value;
    expect(result.rules.map((r) => r.id).slice(0, 3)).toEqual(['r_b', 'r_a', 'r_a2']);
    expect(result.rules[3]!.id).toMatch(/^r_[a-z0-9]+$/);
    expect(new Set(result.rules.map((r) => r.id)).size).toBe(4);
    expect(result.rules[0]!.target).toEqual({ kind: 'builtin', name: 'REJECT' });
  });

  it('导入真实风格片段，保留筛选条件并剥离节点，结果通过 core 模板校验', () => {
    const result = imported(`
proxies:
  - { name: 香港节点, type: ss, server: example.com, port: 443 }
proxy-providers:
  机场: { type: http, url: 'https://example.com/sub' }
dns: { enable: true }
proxy-groups:
  - name: 代理
    type: select
    proxies: [自动, 香港节点, DIRECT]
    use: [机场]
    filter: 香港
    exclude-filter: 到期
    exclude-type: direct
    include-all: true
    include-all-proxies: true
    include-all-providers: true
    custom-field: { keep: true }
  - name: 自动
    type: url-test
    url: https://example.com/204
    interval: 300
    proxies: [香港节点]
rules:
  - DOMAIN-SUFFIX,example.com,代理
  - RULE-SET,广告规则,REJECT
  - MATCH,代理
`);
    expect(result.notes.join('\n')).toContain('已忽略：proxies、proxy-providers、dns');
    for (const key of ['use', 'include-all', 'include-all-proxies', 'include-all-providers', '香港节点']) expect(result.notes.join('\n')).toContain(key);
    const [select, auto] = result.value.groups;
    expect(select!.members).toEqual([{ kind: 'group', groupId: auto!.id }, direct]);
    expect(select!.extra).toEqual({ 'custom-field': { keep: true } });
    expect(select).toMatchObject({ filter: '香港', excludeFilter: '到期', excludeType: 'direct' });
    expect(auto!.members).toEqual([]);
    const report = validateTemplate({ id: 'imported', version: 1, ...result.value }, {
      rulesets: { rs_ads: { id: 'rs_ads', name: '广告规则', sources: [] } },
    });
    expect(report.items.filter((item) => item.level === 'error')).toEqual([]);
  });

  it.each([
    ['YAML 语法错', 'proxy-groups: [\nrules: []', 'YAML 解析失败'],
    ['未知组类型', 'proxy-groups:\n  - name: 代理\n    type: relay\nrules: []', '类型「relay」不受支持'],
    ['节点出口', 'rules:\n  - DOMAIN,example.com,香港节点', '第 1 条规则「DOMAIN,example.com,香港节点」'],
    ['不存在的规则集', 'rules:\n  - RULE-SET,不存在,DIRECT', '规则集「不存在」不存在'],
    ['规则缺少值', 'rules:\n  - DOMAIN,,DIRECT', '第 1 条规则「DOMAIN,,DIRECT」'],
  ])('%s 返回中文错误和行号', (_name, yaml, error) => {
    const result = templateFromYaml(yaml, empty, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain(error);
    expect(result.line).toBeGreaterThan(0);
  });

  it('FINAL 可设置出口，多条 MATCH 取第一条；无 MATCH 时保留当前出口', () => {
    const multiple = imported('rules: ["FINAL,REJECT", "MATCH,DIRECT", "FINAL,PASS"]');
    expect(multiple.value.final).toEqual({ kind: 'builtin', name: 'REJECT' });
    expect(multiple.notes).toHaveLength(2);
    const missing = imported('rules: []');
    expect(missing.value.final).toEqual(empty.final);
    expect(missing.notes.join()).toContain('沿用');
  });

  it('按名称导入规则集，导出找不到名称时使用带命名空间的 ID', () => {
    const context: ConvertCtx = { rulesets: [{ id: 'rs', name: '同名' }] };
    expect(imported('rules: ["RULE-SET,同名,DIRECT"]', empty, context).value.rules[0]!.matcher).toEqual({ kind: 'ruleset', id: 'rs' });
    expect(templateToYaml({ ...empty, rules: [{ id: 'r', matcher: { kind: 'ruleset', id: 'missing' }, target: direct }] }, ctx)).toContain('RULE-SET,local:missing,DIRECT');
  });

  it('增删 no-resolve/src 选项保持规则 ID，不再保存启用字段', () => {
    const t: TemplateBody = { ...empty, rules: [{ id: 'r', matcher: { kind: 'rule', rule: { type: 'IP-CIDR', value: '10.0.0.0/8' } }, target: direct, options: { noResolve: false, src: false } }] };
    const enabled = imported('rules: ["IP-CIDR,10.0.0.0/8,DIRECT,no-resolve,src"]', t).value;
    expect(enabled.rules[0]).toStrictEqual({ ...t.rules[0], matcher: { kind: 'rule', rule: { type: 'IP-CIDR', value: '10.0.0.0/8', noResolve: true } }, options: { src: true } });
    const removed = imported('rules: ["IP-CIDR,10.0.0.0/8,DIRECT"]', enabled).value;
    expect(removed.rules[0]).toStrictEqual({ ...t.rules[0], options: { src: false } });
  });

  it('出口前后的 no-resolve/src 选项都保留，数字状态码映射为字符串', () => {
    const result = imported('proxy-groups: [{name: 自动, type: url-test, expected-status: 204}]\nrules: ["IP-CIDR,10.0.0.0/8,no-resolve,DIRECT,src"]');
    expect(result.value.groups[0]!.test).toEqual({ expectedStatus: '204' });
    expect(result.value.rules[0]).toMatchObject({
      matcher: { kind: 'rule', rule: { type: 'IP-CIDR', value: '10.0.0.0/8', noResolve: true } },
      target: direct, options: { src: true },
    });
  });

  it('原文标记保留，旧独立选项清理，false 与空对象仍能往返', () => {
    const t: TemplateBody = {
      groups: [{ id: 'g', name: '空组', type: 'select', members: [], test: {}, display: {}, extra: {} }], final: direct,
      rules: [
        { id: 'r_both', matcher: { kind: 'rule', rule: { type: 'IP-CIDR6', value: '::/0', noResolve: true } }, target: direct, options: { noResolve: true } },
        { id: 'r_false', matcher: { kind: 'rule', rule: { type: 'IP-ASN', value: '1234', noResolve: false } }, target: direct, options: { noResolve: false, src: false } },
        { id: 'r_src', matcher: { kind: 'rule', rule: { type: 'SRC-IP-CIDR', value: '10.0.0.0/8', noResolve: true } }, target: direct, options: {} },
      ],
    };
    const yaml = templateToYaml(t, ctx);
    expect(yaml.match(/no-resolve/g)).toHaveLength(2);
    expect(imported(yaml, t).value).toStrictEqual({ ...t, rules: t.rules.map(rule => { const { noResolve: _, ...options } = rule.options ?? {}; return { ...rule, options }; }) });
  });

  it('畸形逻辑规则导出明确报错，不静默丢弃', () => {
    const t: TemplateBody = { ...empty, rules: [{ id: 'r', matcher: { kind: 'rule', rule: { type: 'AND', children: [] } }, target: direct }] };
    expect(() => templateToYaml(t, ctx)).toThrow('逻辑规则子条件数量不合法');
  });

  it('不将非法结构或多余规则字段静默转换成有效模板', () => {
    for (const yaml of ['[]', 'proxy-groups: {}', 'rules: {}', 'rules: [123]', 'rules: ["DOMAIN,x,garbage,DIRECT"]', 'proxy-groups: [{name: A, type: select, proxies: DIRECT}]', 'proxy-groups: [{name: A, type: select}, {name: A, type: select}]']) {
      expect(templateFromYaml(yaml, empty, ctx).ok).toBe(false);
    }
  });

  it('旧 YAML 的停用注释移除对应规则，普通注释仍保留规则', () => {
    const result = imported('rules:\n  # 普通说明\n  - DOMAIN,a.example,DIRECT\n  # disabled\n  - DOMAIN,b.example,DIRECT\n  - DOMAIN,c.example,DIRECT # disabled\n');
    expect(result.value.rules).toHaveLength(1);
    expect(result.value.rules[0]!.matcher).toEqual({ kind: 'rule', rule: { type: 'DOMAIN', value: 'a.example' } });
    expect(result.value.rules[0]).not.toHaveProperty('enabled');
    const plain = parse(templateToYaml(fixture(), ctx));
    expect(Object.keys(plain)).toEqual(['proxy-groups', 'rules', 'x-sub-forge-rulesets']);
    expect(imported(stringify(plain), fixture()).value.rules.every((r) => r.enabled !== false)).toBe(true);
  });

  it('newId 包含时间 base36 和恰好四位随机字符', () => {
    const time = vi.spyOn(Date, 'now').mockReturnValue(123456);
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      expect(newId('g')).toBe(`g_${(123456).toString(36)}0000`);
      random.mockReturnValue(0.999999999);
      expect(newId('r')).toBe(`r_${(123456).toString(36)}zzzz`);
    } finally {
      time.mockRestore();
      random.mockRestore();
    }
  });
});

it('旧模板导出时移除停用规则且清除启用字段，不改变原对象', () => {
  const value: TemplateBody = { groups: [], final: direct, rules: [
    { id: 'off', matcher: { kind: 'rule', rule: { type: 'DOMAIN', value: 'off.test' } }, target: direct, enabled: false },
    { id: 'on', matcher: { kind: 'rule', rule: { type: 'DOMAIN', value: 'on.test' } }, target: direct, enabled: true },
  ] };
  const yaml = templateToYaml(value, ctx);
  expect(yaml).not.toContain('off.test');
  expect(yaml).not.toContain('disabled');
  const next = templateFromYaml(yaml, value, ctx);
  expect(next.ok && next.value.rules).toEqual([{ id: 'on', matcher: { kind: 'rule', rule: { type: 'DOMAIN', value: 'on.test' } }, target: direct }]);
  expect(value.rules[0]!.enabled).toBe(false);
});

describe('模板导入远程 URL', () => {
  const url = 'https://example.test/Lan.list?branch=main&version=1';
  it('从 provider 只取 URL，RULE-SET 优先引用外部来源，不匹配同名系统 ID', () => {
    const text = `rule-providers:\n  lan:\n    type: http\n    behavior: classical\n    format: text\n    url: "${url}"\n    path: ./rules/lan.list\n    interval: 259200\nrules:\n  - RULE-SET,lan,DIRECT,no-resolve\n  - MATCH,REJECT`;
    const body = imported(text, empty, { rulesets: [{id:'local-lan',name:'lan'}] }).value;
    expect(body.rules[0]!.matcher).toMatchObject({ kind:'ruleset', remote: {url} });
    expect(Object.keys(body.rules[0]!.matcher)).toEqual(['kind','id','remote']);
    expect(body.rules[0]!.options?.noResolve).toBeUndefined();
    expect(imported(templateToYaml(body,ctx),body).value).toEqual(body);
  });
  it('仅提供 rule-providers 时补入现有模板，保留组、规则和最终出口，重复 URL 不新增', () => {
    const current = fixture();
    const text = `rule-providers:\n  lan: {url: "${url}"}\n  same: {url: "${url}"}`;
    const first = imported(text,current);
    expect(first.value.groups).toEqual(current.groups); expect(first.value.final).toEqual(current.final);
    expect(first.value.rules.slice(0,current.rules.length)).toEqual(current.rules);
    expect(first.value.rules).toHaveLength(current.rules.length+1);
    expect(first.value.rules.at(-1)!.target).toEqual({kind:'builtin',name:'REJECT'});
    expect(imported(text,first.value).value).toEqual(first.value);
  });
  it('无 URL、本地文件地址及不合法的引用映射明确报错', () => {
    for(const value of ['path: ./local.list', 'url: file:///tmp/local.list', 'url: ftp://example.test/rules']) {
      const result=templateFromYaml(`rule-providers:\n  lan: {${value}}\nrules: ["RULE-SET,lan,DIRECT"]`,empty,ctx);
      expect(result.ok).toBe(false);
    }
    const body=imported(`rule-providers:\n  lan: {url: "${url}"}`).value;
    expect(templateFromYaml(templateToYaml(body,ctx).replace(url,'https://example.test/changed'),body,ctx).ok).toBe(false);
  });
  it('Clash 配置常用锚点不干扰 URL 提取', () => {
    const body=imported(`rule-anchor:\n  domain: &domain {type: http, format: mrs, behavior: domain}\nrule-providers:\n  lan:\n    <<: *domain\n    url: "${url}"\nrules: ["RULE-SET,lan,DIRECT"]`).value;
    expect(body.rules[0]!.matcher).toMatchObject({remote:{url}});
  });
});
