import { describe, expect, it } from 'vitest';
import { expandLocalRules, localRuleLines, localRulesError, validateTemplate, type LocalMatcher } from '../src/index.ts';

const matcher: LocalMatcher = { kind: 'local', content: '# 保留注释\nDOMAIN,a.test\n\nIP-CIDR,198.51.100.0/24,no-resolve\nDOMAIN,a.test' };
describe('多行本地规则卡片', () => {
  it('保留顺序与重复项，只跳过空行和注释', () => {
    expect(localRuleLines(matcher.content).map(x => x.line)).toEqual([2, 4, 5]);
    expect(expandLocalRules(matcher).map(r => r.type === 'RAW' && r.text)).toEqual(['DOMAIN,a.test', 'IP-CIDR,198.51.100.0/24,no-resolve', 'DOMAIN,a.test']);
  });
  it('客户端限制保留，整组追加只执行一次，替换和丢弃作用于整组', () => {
    const append = { type: 'RAW' as const, text: 'DOMAIN,append.test' };
    expect(expandLocalRules({ ...matcher, client: 'surge' }).every(r => r.type === 'RAW' && r.client === 'surge')).toBe(true);
    for (const [action, length] of [[{ append: [append] }, 4], [{ replace: [append] }, 1], [{ drop: true }, 0]] as const) {
      expect(expandLocalRules({ ...matcher, overrides: [{ when: { client: 'mihomo' }, action: structuredClone(action) as NonNullable<LocalMatcher['overrides']>[number]['action'] }] }, { client: 'mihomo' })).toHaveLength(length);
    }
  });
  it('空内容、非法客户端和单行隐藏分隔符不能保存', () => {
    for (const value of [{ content: '# 注释\n' }, { content: 'DOMAIN,a\u2028DOMAIN,b' }, { content: 'DOMAIN,a', client: 'bad' }]) {
      expect(localRulesError(value)).toBeTruthy();
    }
    const template = { id: 't', version: 1, groups: [], rules: [{ id: 'r', matcher: { kind: 'local' as const, content: '' }, target: { kind: 'builtin' as const, name: 'DIRECT' as const } }], final: { kind: 'builtin' as const, name: 'DIRECT' as const } };
    expect(validateTemplate(template).hasErrors).toBe(true);
  });
});
