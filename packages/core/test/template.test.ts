import { describe, expect, it } from 'vitest';
import { Report } from '../src/report.ts';
import { mergeTemplate } from '../src/template/merge.ts';
import { validateTemplate } from '../src/template/validate.ts';
import type { Overlay, Template } from '../src/types.ts';

const g = (id: string, name: string, extra: Partial<Template['groups'][number]> = {}): Template['groups'][number] => ({ id, name, type: 'select', members: [], ...extra });

const TPL: Template = {
  id: 'std', version: 14,
  groups: [
    g('sel', '🚀 节点选择', { members: [{ kind: 'group', groupId: 'auto' }, { kind: 'builtin', name: 'DIRECT' }] }),
    g('auto', '♻️ 自动选择', { type: 'url-test' }),
    g('hk', '🇭🇰 香港', { type: 'url-test' }),
    g('ai', '🤖 AI 服务'),
    g('fish', '🐟 漏网之鱼', { members: [{ kind: 'group', groupId: 'sel' }, { kind: 'builtin', name: 'DIRECT' }] }),
  ],
  rules: [
    { id: 'r-ai', matcher: { kind: 'ruleset', id: 'ai' }, target: { kind: 'group', groupId: 'ai' } },
    { id: 'r-tg', matcher: { kind: 'ruleset', id: 'telegram' }, target: { kind: 'group', groupId: 'sel' } },
    { id: 'r-cn', matcher: { kind: 'rule', rule: { type: 'GEOIP', value: 'CN', noResolve: true } }, target: { kind: 'builtin', name: 'DIRECT' } },
  ],
  final: { kind: 'group', groupId: 'fish' },
};

describe('模板 ⊕ 覆盖层', () => {
  it('填充成员、调整参数、插入私有组与私有规则、禁用和改出口', () => {
    const overlay: Overlay = {
      groupPatches: {
        hk: { addMembers: [{ kind: 'nodeset', ref: { type: 'source', id: 'a' } }], set: { filter: '(?i)港|HK', test: { interval: 300 } } },
        sel: { addMembers: [{ kind: 'group', groupId: 'relay' }], memberOrder: 'prepend' },
      },
      extraGroups: [{ after: 'hk', group: g('relay', '🌠 中转', { members: [{ kind: 'nodeset', ref: { type: 'source', id: 't' } }] }) }],
      rulePatches: { 'r-tg': { target: { kind: 'node', ref: { nodeSet: { type: 'source', id: 's' }, match: { exact: 'US' } } } }, 'r-cn': { enabled: false } },
      extraRules: [{ anchor: { before: 'r-tg' }, rule: { id: 'p-wechat', matcher: { kind: 'rule', rule: { type: 'PROCESS', kind: 'path', mode: 'wildcard', value: '/Applications/*/WeChat.app/*' } }, target: { kind: 'builtin', name: 'DIRECT' } } }],
    };
    const report = new Report();
    const e = mergeTemplate(TPL, overlay, report);
    expect(e.groups.map((x) => `${x.id}:${x.origin}`)).toEqual(['sel:template', 'auto:template', 'hk:template', 'relay:profile', 'ai:template', 'fish:template']);
    expect(e.groups[0]!.members[0]).toEqual({ kind: 'group', groupId: 'relay' });
    expect(e.groups[2]).toMatchObject({ filter: '(?i)港|HK', test: { interval: 300 }, members: [{ kind: 'nodeset' }] });
    expect(e.rules.map((r) => r.id)).toEqual(['r-ai', 'p-wechat', 'r-tg', 'r-cn']);
    expect(e.rules[2]!.target.kind).toBe('node');
    expect(e.rules[3]!.enabled).toBe(false);
    expect(e.final).toEqual({ kind: 'group', groupId: 'fish' });
    expect(report.items).toEqual([]);
  });

  it('模板组不能在 Profile 中改名或隐藏', () => {
    const report = new Report();
    const e = mergeTemplate(TPL, { groupPatches: { ai: { set: { name: '改名', display: { hidden: true } } } } }, report);
    expect(e.groups.find((x) => x.id === 'ai')).toMatchObject({ name: '🤖 AI 服务', display: { hidden: false } });
    expect(report.byCode('overlay.forbidden')).toHaveLength(2);
  });

  it('模板删除了元素后，对应覆盖项成为孤儿且不输出', () => {
    const report = new Report();
    const e = mergeTemplate(TPL, {
      groupPatches: { bahamut: { addMembers: [{ kind: 'builtin', name: 'DIRECT' }] } },
      rulePatches: { 'r-bahamut': { enabled: false } },
      extraRules: [{ anchor: { after: 'r-bahamut' }, rule: { id: 'x', matcher: { kind: 'rule', rule: { type: 'DOMAIN', value: 'a.com' } }, target: { kind: 'builtin', name: 'DIRECT' } } }],
    }, report);
    expect(e.groups).toHaveLength(5);
    expect(e.rules.map((r) => r.id)).toEqual(['r-ai', 'r-tg', 'r-cn']);
    expect(report.byCode('overlay.orphan').map((i) => i.where)).toEqual(['group:bahamut', 'rule:r-bahamut', 'rule:x']);
  });

  it('模板更新自动同步：新版本新增的组直接出现在合并结果中', () => {
    const v15: Template = { ...TPL, version: 15, groups: [...TPL.groups, g('game', '🎮 游戏平台')] };
    const e = mergeTemplate(v15, {}, new Report());
    expect(e.groups.at(-1)!.name).toBe('🎮 游戏平台');
  });
});

describe('模板校验', () => {
  const inputs = { rulesets: { telegram: { id: 'telegram', name: 'TG', sources: [] }, ai: { id: 'ai', name: 'AI', sources: [] } } };

  it('合法模板无问题', () => {
    expect(validateTemplate(TPL, inputs).items).toEqual([]);
  });

  it('模板可预设节点筛选条件，订阅填入节点集后生效', () => {
    expect(validateTemplate({ ...TPL, groups: TPL.groups.map(group => ({ ...group, filter: '(?i)港|HK', excludeFilter: '到期', excludeType: 'direct' })) }, inputs).items).toEqual([]);
  });

  it('发现悬挂引用、环、节点、重复名', () => {
    const bad: Template = {
      ...TPL,
      groups: [
        g('a', 'A', { members: [{ kind: 'group', groupId: 'b' }] }),
        g('b', 'B', { members: [{ kind: 'group', groupId: 'a' }, { kind: 'nodeset', ref: { type: 'source', id: 'x' } }], filter: 'HK' }),
        g('c', 'A'),
      ],
      rules: [
        { id: 'r1', matcher: { kind: 'ruleset', id: 'ai' }, target: { kind: 'group', groupId: 'gone' } },
        { id: 'r2', matcher: { kind: 'ruleset', id: 'nope' }, target: { kind: 'node', ref: { nodeSet: { type: 'source', id: 's' }, match: { exact: 'n' } } } },
      ],
      final: { kind: 'group', groupId: 'gone' },
    };
    const r = validateTemplate(bad, inputs);
    expect(r.items.map((i) => i.code).sort()).toEqual([
      'template.dangling-group',
      'template.dangling-group',
      'template.dangling-ruleset',
      'template.duplicate-name',
      'template.group-cycle',
      'template.node-in-template',
      'template.node-in-template',
    ]);
  });
});


it('模板拒绝旧平台条件，避免保存后扩大为内核范围', () => {
  const t = structuredClone(TPL);
  const matcher = t.rules[2]!.matcher;
  if (matcher.kind !== 'rule') throw new Error('缺少本地测试规则');
  matcher.overrides = [{ when: { client: 'surge', platform: 'ios' } as any, action: { drop: true } }];
  expect(validateTemplate(t).byCode('template.invalid-override')).toHaveLength(1);
});
