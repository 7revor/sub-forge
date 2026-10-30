import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { templateFromYaml, templateToYaml, type TemplateBody } from './templateYaml.ts';
const direct = { kind: 'builtin' as const, name: 'DIRECT' as const };
const body: TemplateBody = { groups: [], rules: [
  { id: 'a', matcher: { kind: 'local', content: '# 注释\nDOMAIN,a.test\n\nIP-CIDR,198.51.100.0/24,no-resolve' }, target: direct },
  { id: 'b', matcher: { kind: 'rule', rule: { type: 'RAW', text: 'DOMAIN,b.test' } }, target: direct },
  { id: 'c', matcher: { kind: 'local', content: 'DOMAIN,c.test\nDOMAIN,d.test' }, target: direct },
], final: direct };
const empty: TemplateBody = { groups: [], rules: [], final: direct };
describe('本地多条规则的 YAML 往返', () => {
  it('输出标准规则列表，重新导入仍保留卡片、注释和 ID', () => {
    const yaml = templateToYaml(body, { rulesets: [] });
    expect(parse(yaml).rules).toEqual(['DOMAIN,a.test,DIRECT', 'IP-CIDR,198.51.100.0/24,DIRECT,no-resolve', 'DOMAIN,b.test,DIRECT', 'DOMAIN,c.test,DIRECT', 'DOMAIN,d.test,DIRECT', 'MATCH,DIRECT']);
    const result = templateFromYaml(yaml, empty, { rulesets: [] });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.rules.filter(r => r.matcher.kind === 'local')).toEqual([body.rules[0], body.rules[2]]);
    expect(result.value.rules).toHaveLength(3);
    expect(templateFromYaml(yaml, body, { rulesets: [] })).toMatchObject({ ok: true, value: body });
  });
  it('客户端限制、整组覆盖和 src 选项在往返中保留', () => {
    const value: TemplateBody = { ...empty, rules: [{ id: 'surge', target: direct, options: { src: true }, matcher: { kind: 'local', client: 'surge', content: '# 原文\nDOMAIN,a.test\nIP-CIDR,198.51.100.0/24,no-resolve', overrides: [{ when: { client: 'stash' }, action: { drop: true } }] } }] };
    const yaml = templateToYaml(value, { rulesets: [] });
    expect(templateFromYaml(yaml, empty, { rulesets: [] })).toMatchObject({ ok: true, value });
  });
  it('正文或出口修改后按实际 YAML 导入，旧元数据不能覆盖修改', () => {
    const yaml = templateToYaml(body, { rulesets: [] }).replace('DOMAIN,a.test,DIRECT', 'DOMAIN,changed.test,REJECT');
    const result = templateFromYaml(yaml, empty, { rulesets: [] });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.rules[0]).toMatchObject({ target: { name: 'REJECT' } });
    expect(result.value.rules[0]?.matcher.kind).toBe('rule');
  });
  it('伪造分组内容不能替换实际规则', () => {
    const doc = parse(templateToYaml(body, { rulesets: [] }));
    doc['x-sub-forge-local-rules'][0].entry.matcher.content = 'DOMAIN,injected.test';
    const result = templateFromYaml(stringify(doc), empty, { rulesets: [] });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.value.rules.some(r => r.matcher.kind === 'local' && r.matcher.content.includes('injected'))).toBe(false);
  });
});
