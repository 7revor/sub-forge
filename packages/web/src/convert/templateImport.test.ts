import { validateTemplate } from '@sub-forge/core';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import sample from './fixtures/template-full-config.yaml?raw';
import { templateFromYaml, templateFormFromYaml, templateToYaml, type TemplateBody } from './templateYaml';

const empty: TemplateBody = { groups: [], rules: [], final: { kind: 'builtin', name: 'REJECT' } };
const ctx = { rulesets: [] };
function imported(text: string, current = empty) {
  const result = templateFromYaml(text, current, ctx);
  expect(result.ok, !result.ok ? result.error : '').toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe('完整配置提取模板', () => {
  it('数字形式的来源名称也按输入顺序保留', () => {
    const body = imported('rule-providers:\n  "20": {url: https://example.test/20}\n  "3": {url: https://example.test/3}\nrules: ["MATCH,DIRECT"]').value;
    const output = templateToYaml(body, ctx);
    expect(imported(output, body).value.ruleProviders?.map(p => p.name)).toEqual(['20', '3']);
    expect(imported('- MATCH,DIRECT', body).value.ruleProviders).toEqual(body.ruleProviders);
  });

  it('用户原样配置指出第七条规则缺失的组名、修正办法和准确行号，不修改原草稿', () => {
    const before = structuredClone(empty);
    expect(templateFromYaml(sample, empty, ctx)).toMatchObject({
      ok: false, line: sample.split('\n').findIndex(line => line.includes('RULE-SET,microsoft')) + 1,
      error: expect.stringContaining('第 7 条规则「RULE-SET,microsoft,🖥️ 微软服务」：出口「🖥️ 微软服务」未在 proxy-groups 中定义'),
    });
    expect(empty).toEqual(before);
  });

  it('补齐出口后保留十个来源和全部规则顺序，剥离三个节点，不为 google 添加规则', () => {
    const data = parse(sample);
    data['proxy-groups'].push({ name: '🖥️ 微软服务', type: 'select', proxies: ['🚀 科学上网', 'DIRECT'] });
    const result = imported(stringify(data));
    const body = result.value;
    const [proxy, domestic, other, microsoft] = body.groups;
    expect(body.groups.map(g => g.name)).toEqual(data['proxy-groups'].map((g: { name: string }) => g.name));
    expect(proxy!.members).toEqual([]);
    expect(domestic!.members).toEqual([{ kind: 'builtin', name: 'DIRECT' }, { kind: 'group', groupId: proxy!.id }]);
    expect(other!.members).toEqual([{ kind: 'group', groupId: proxy!.id }, { kind: 'builtin', name: 'DIRECT' }]);
    expect(body.ruleProviders?.map(p => p.name)).toEqual(Object.keys(data['rule-providers']));
    expect(body.ruleProviders).toHaveLength(10);
    expect(body.rules).toHaveLength(10);
    expect(body.rules[6]!.target).toEqual({ kind: 'group', groupId: microsoft!.id });
    expect(body.final).toEqual({ kind: 'group', groupId: other!.id });
    expect(result.notes.join('\n')).toContain('google；未添加分流规则');
    expect(result.notes.filter(n => n.includes('已忽略节点成员'))).toHaveLength(3);
    const output = templateToYaml(body, ctx);
    expect(parse(output).rules).toEqual(data.rules);
    expect(Object.keys(parse(output)['rule-providers'])).toEqual(Object.keys(data['rule-providers']));
    expect(imported(output, body).value).toEqual(body);
    expect(templateFormFromYaml(output, body, ctx).value).toEqual(body);
    expect(validateTemplate({ ...body, id: 'sample', version: 1 }).items).toEqual([]);
  });

  it('完整配置忽略运行参数和节点订阅，支持前向组引用、所有内置策略和 YAML 锚点合并', () => {
    const text = `mixed-port: 7890
proxies: [{name: 单节点, type: ss, server: example.test, port: 443}]
proxy-providers: {机场: {type: http, url: https://example.test/sub}}
dns: {enable: true}
group-default: &group {type: select, proxies: [后组, 单节点, DIRECT, REJECT, REJECT-DROP, PASS], use: [机场], include-all: true}
source-default: &source {type: http, url: https://example.test/list}
proxy-groups:
  - {<<: *group, name: 前组}
  - {name: 后组, type: select, proxies: [DIRECT]}
rule-providers:
  first: *source
  second: {<<: *source}
rules: ["RULE-SET,second,前组", "RULE-SET,first,REJECT", "MATCH,后组"]`;
    const body = imported(text).value;
    expect(body.groups[0]!.members).toEqual([{ kind: 'group', groupId: body.groups[1]!.id }, ...['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS'].map(name => ({ kind: 'builtin', name }))]);
    expect(body.groups[0]!.extra).toBeUndefined();
    expect(body.ruleProviders?.map(p => p.name)).toEqual(['first', 'second']);
    expect(parse(templateToYaml(body, ctx)).rules).toEqual(parse(text).rules);
    expect(templateFormFromYaml(text, body, ctx).value).toEqual(body);
    expect(imported(templateToYaml(body, ctx), body).value).toEqual(body);
  });

  it('片段编辑保留未使用来源，完整替换可清除来源，失败时不修改原草稿', () => {
    const body = imported('rule-providers: {unused: {url: https://example.test/unused}}\nrules: ["MATCH,DIRECT"]').value;
    const edited = imported('- DOMAIN,example.test,DIRECT\n- MATCH,REJECT', body).value;
    expect(edited.ruleProviders).toEqual(body.ruleProviders);
    expect(imported('rules: ["MATCH,DIRECT"]', body).value.ruleProviders).toBeUndefined();
    const before = structuredClone(body);
    expect(templateFromYaml('rule-providers: {invalid: {url: file:///local}}', body, ctx).ok).toBe(false);
    expect(body).toEqual(before);
  });
});
