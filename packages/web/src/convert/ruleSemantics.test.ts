import { expect, it } from 'vitest';
import { parseRuleLine } from '@sub-forge/core';
import { templateFromYaml, templateToYaml, type TemplateBody } from './templateYaml.ts';
import { ruleToLine } from '../components/rule.ts';

it('模板往返保留逻辑、含逗号的正则和扩展匹配', () => {
  const lines = ['AND,((DOMAIN,a.test),(DST-PORT,443))', 'URL-REGEX,"^https://a[.]test/a,b",extended-matching', 'DOMAIN,a.test,extended-matching'];
  const template: TemplateBody = { groups: [], rules: lines.map((line, i) => ({ id: String(i), matcher: { kind: 'rule', rule: parseRuleLine(line) }, target: { kind: 'builtin', name: 'DIRECT' } })), final: { kind: 'builtin', name: 'DIRECT' } };
  const yaml = templateToYaml(template, { rulesets: [] });
  const result = templateFromYaml(yaml, template, { rulesets: [] });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  expect(result.value.rules).toEqual(template.rules);
  expect(ruleToLine(parseRuleLine(lines[2]!))).toBe(lines[2]);
});
