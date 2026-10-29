import { composeRule, lowerRule, parseRuleLine, remoteRuleMatcher, rawRuleParts, UnsupportedRuleError, stableStringify, type Builtin, type GroupSpec, type Matcher, type RuleEntry, type Target, type Template } from '@sub-forge/core';
import { Document, isAlias, isMap, isNode, isScalar, isSeq, LineCounter, parseDocument } from 'yaml';
import { recoverYaml } from './recoverYaml.ts';
import { parseYamlDocument } from './yamlDocument.ts';

export type TemplateBody = Pick<Template, 'groups' | 'rules' | 'final' | 'ruleProviders'>;
export type NamedRef = { id: string; name: string };
export type ConvertCtx = { rulesets: NamedRef[] };

const builtins = new Set<string>(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS']);
const groupTypes = new Set<string>(['select', 'url-test', 'fallback', 'load-balance']);
const testFields = {
  url: 'url', interval: 'interval', timeout: 'timeout', tolerance: 'tolerance',
  lazy: 'lazy', 'max-failed-times': 'maxFailedTimes', 'expected-status': 'expectedStatus',
} as const;
const filterFields = { filter: 'filter', 'exclude-filter': 'excludeFilter', 'exclude-type': 'excludeType' } as const;
const knownFields = new Set(['name', 'type', 'proxies', 'strategy', 'hidden', 'icon', 'empty-fallback', ...Object.keys(testFields), ...Object.keys(filterFields)]);
const nodeField = (key: string) => key === 'use' || key.startsWith('include-all');
const referenceField = 'x-sub-forge-rulesets';

function rulesetAlias(m: Extract<Matcher, { kind: 'ruleset' }>, ctx: ConvertCtx): string {
  if (m.repository || m.remote) return m.id;
  const name = ctx.rulesets.find(r => r.id === m.id)?.name;
  return name && !name.includes(',') && !name.startsWith('repo:') && !name.startsWith('remote:') && !name.startsWith('local:') && ctx.rulesets.filter(r => r.name === name).length === 1 ? name : `local:${encodeURIComponent(m.id)}`;
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, '0')}`;
}

function lowerMatcher(matcher: Extract<Matcher, { kind: 'rule' }>) {
  const lowered = lowerRule(matcher.rule, { client: 'mihomo' });
  if (lowered.kind === 'drop') throw new Error(`无法导出规则：${lowered.reason}`);
  return { ...lowered, noResolve: lowered.noResolve || ('noResolve' in matcher.rule && matcher.rule.noResolve) };
}

function targetName(target: Target, groups: GroupSpec[]): string {
  if (target.kind === 'builtin') return target.name;
  if (target.kind === 'group') {
    const group = groups.find((g) => g.id === target.groupId);
    if (group) return group.name;
    throw new Error(`出口引用的模板组「${target.groupId}」不存在`);
  }
  throw new Error('模板出口不能是节点');
}

export function templateToYaml(t: TemplateBody, ctx: ConvertCtx): string {
  t = { ...t, rules: t.rules.filter(rule => rule.enabled !== false).map(({ enabled: _, ...rule }) => rule) };
  const groups = t.groups.map((g) => {
    const out: Record<string, unknown> = {
      name: g.name, type: g.type,
      proxies: g.members.map((m) => {
        if (m.kind !== 'builtin' && m.kind !== 'group') throw new Error(`模板组「${g.name}」不能包含节点或节点集`);
        return targetName(m, t.groups);
      }),
    };
    for (const [yamlKey, key] of Object.entries(testFields)) {
      if (g.test?.[key] !== undefined) out[yamlKey] = g.test[key];
    }
    if (g.strategy !== undefined) out.strategy = g.strategy;
    for (const [yamlKey, key] of Object.entries(filterFields)) if (g[key] !== undefined) out[yamlKey] = g[key];
    if (g.display?.hidden !== undefined) out.hidden = g.display.hidden;
    if (g.display?.icon !== undefined) out.icon = g.display.icon;
    const { 'empty-fallback': _emptyFallback, ...extra } = g.extra ?? {};
    return { ...out, ...extra };
  });
  const providerAlias = (r: RuleEntry) => {
    const m = r.matcher;
    if (m.kind !== 'ruleset') return '';
    const provider = m.remote && t.ruleProviders?.find(p => p.name === r.providerName && p.url === m.remote!.url);
    return provider ? provider.name : rulesetAlias(m, ctx);
  };
  const lines = t.rules.map((r) => {
    const m = r.matcher;
    const lowered = m.kind === 'rule' ? lowerMatcher(m) : {
      text: `RULE-SET,${providerAlias(r)}`,
    };
    return composeRule({ ...lowered, src: ('src' in lowered && lowered.src) || r.options?.src }, targetName(r.target, t.groups));
  });
  lines.push(`MATCH,${targetName(t.final, t.groups)}`);
  const references = Object.fromEntries(t.rules.flatMap(r => r.matcher.kind === 'ruleset' ? [[providerAlias(r), r.matcher]] : []));
  const providers = new Map((t.ruleProviders ?? []).map(p => [p.name, { type: 'http', url: p.url }]));
  const doc = new Document({ 'proxy-groups': groups, ...(t.ruleProviders?.length ? { 'rule-providers': providers } : {}), rules: lines, ...(Object.keys(references).length ? { [referenceField]: references } : {}) });
  const groupNodes = doc.get('proxy-groups', true);
  if (isSeq(groupNodes)) t.groups.forEach((g, i) => {
    const item = groupNodes.items[i];
    if (isNode(item)) item.commentBefore = ` sub-forge-group: ${encodeURIComponent(g.id)}`;
  });
  const rules = doc.get('rules', true);
  if (isSeq(rules)) t.rules.forEach((r, i) => {
    const item = rules.items[i];
    if (isNode(item)) item.commentBefore = ` sub-forge-rule: ${encodeURIComponent(r.id)}`;
  });
  return doc.toString({ lineWidth: 0 });
}

// no-resolve 和 src 属于选项；修改选项或出口不应使覆盖层失去规则 ID。
function matcherKey(m: Matcher): string {
  if (m.kind !== 'rule') return `${m.kind}:${m.id}${m.repository ? `:${stableStringify(m.repository)}` : m.remote ? `:${m.remote.url}` : ''}`;
  const lowered = lowerRule(m.rule, { client: 'mihomo' });
  return `rule:${lowered.kind === 'ok' ? lowered.text : JSON.stringify(m.rule)}`;
}

function restoreRule(matcher: Matcher, old: RuleEntry | undefined, noResolve: boolean, src: boolean): Pick<RuleEntry, 'matcher' | 'options'> {
  const { noResolve: _legacyNoResolve, ...options } = old?.options ?? {};
  const oldRaw = old?.matcher.kind === 'rule' && old.matcher.rule.type === 'RAW' ? rawRuleParts(old.matcher.rule.text) : undefined;
  const keepSrcInRule = old?.matcher.kind === 'rule' && ('src' in old.matcher.rule || oldRaw?.src) && old.options?.src === undefined;
  if (!keepSrcInRule && (src || old?.options?.src !== undefined)) options.src = src;
  const oldNoResolve = oldRaw?.noResolve || (old?.matcher.kind === 'rule' && 'noResolve' in old.matcher.rule && old.matcher.rule.noResolve) || false;
  const oldSrc = old?.options?.src || oldRaw?.src || (old?.matcher.kind === 'rule' && 'src' in old.matcher.rule && old.matcher.rule.src) || false;
  if (old && matcherKey(old.matcher) === matcherKey(matcher) && oldNoResolve === noResolve && oldSrc === src) {
    // 保留原始表示和客户端覆盖；历史独立 no-resolve 不参与回显或恢复。
    matcher = old.matcher;
  } else if (matcher.kind === 'rule') {
    if (options.src !== undefined && 'src' in matcher.rule) {
      const { src: _src, ...rule } = matcher.rule;
      matcher = { ...matcher, rule };
    }
    if (old?.matcher.kind === 'rule' && old.matcher.overrides !== undefined) matcher = { ...matcher, overrides: old.matcher.overrides };
  }
  return { matcher, ...(old?.options !== undefined || Object.keys(options).length ? { options } : {}) };
}

export function templateFromYaml(text: string, current: TemplateBody, ctx: ConvertCtx) {
  return readTemplate(text, current, ctx, false);
}

export function templateFormFromYaml(text: string, current: TemplateBody, ctx: ConvertCtx) {
  const result = readTemplate(text, current, ctx, true);
  return result.ok ? { value: result.value, notes: result.notes } : {
    value: { groups: [], rules: [], final: { kind: 'builtin', name: 'REJECT' } } as TemplateBody,
    notes: [`${result.error}；没有可恢复的模板内容，出口已设为 REJECT`],
  };
}

function readTemplate(text: string, current: TemplateBody, ctx: ConvertCtx, recover: boolean):
  | { ok: true; value: TemplateBody; notes: string[] }
  | { ok: false; error: string; line?: number } {
  const lineCounter = new LineCounter();
  let line: number | undefined;
  try {
    const originalDoc = parseDocument(text);
    const providerOnly = isMap(originalDoc.contents) && originalDoc.has('rule-providers') && !originalDoc.has('proxy-groups') && !originalDoc.has('rules');
    const fragment = isSeq(originalDoc.contents);
    const recovered = recover ? recoverYaml(text, 'template') : undefined;
    const doc = recovered?.doc ?? parseYamlDocument(text, { lineCounter, merge: true }, 'template');
    // 独立列表片段沿用已有来源定义，完整配置则以输入内容为准。
    if (fragment && current.ruleProviders?.length) {
      doc.set('rule-providers', doc.createNode(new Map(current.ruleProviders.map(p => [p.name, { url: p.url }]))));
    }
    // 策略组列表作为片段补入，同名组替换；保留其余组，避免现有规则和 MATCH 悬空。
    if (fragment && doc.has('proxy-groups') && !doc.has('rules')) {
      const previous = parseDocument(templateToYaml(current, ctx));
      const incoming = doc.get('proxy-groups', true);
      const existing = previous.get('proxy-groups', true);
      if (isSeq(incoming) && isSeq(existing)) {
        const replacements = new Map(incoming.items.map(item => [isMap(item) ? item.get('name') : undefined, item]));
        const consumed = new Set<unknown>();
        incoming.items = [
          ...existing.items.map(item => {
            const replacement = replacements.get(isMap(item) ? item.get('name') : undefined);
            if (replacement) consumed.add(replacement);
            return replacement ?? item;
          }),
          ...incoming.items.filter(item => !consumed.has(item)),
        ];
      }
      doc.set('rules', previous.get('rules', true));
      if (previous.has(referenceField)) doc.set(referenceField, previous.get(referenceField, true));
    }
    if (fragment && doc.has('rules') && !doc.has('proxy-groups')) {
      const previous = parseDocument(templateToYaml(current, ctx));
      doc.set('proxy-groups', previous.get('proxy-groups', true));
      if (previous.has(referenceField)) doc.set(referenceField, previous.get(referenceField, true));
    }
    if (providerOnly) {
      const previous = parseDocument(templateToYaml(current, ctx));
      doc.set('proxy-groups', previous.get('proxy-groups', true));
      doc.set('rules', previous.get('rules', true));
      if (previous.has(referenceField)) doc.set(referenceField, previous.get(referenceField, true));
    }
    const notes: string[] = recovered?.notes ?? [];
    const attempt = (action: () => void) => {
      try { action(); }
      catch (error) {
        if (!recover) throw error;
        notes.push(`已忽略错误内容：${error instanceof Error ? error.message : String(error)}`);
      }
    };
    const parseError = doc.errors[0];
    if (parseError) return { ok: false, error: `YAML 解析失败：${parseError.message}`, line: parseError.linePos?.[0]?.line };
    const locate = (node: unknown) => { line = isNode(node) && node.range ? lineCounter.linePos(node.range[0]).line : undefined; };
    const identity = (node: unknown, kind: 'group' | 'rule', parent?: unknown): string | undefined => {
      const comments = [isNode(node) ? node.commentBefore : undefined, isNode(node) ? node.comment : undefined, isNode(parent) ? parent.commentBefore : undefined];
      const match = comments.filter(Boolean).join('\n').match(new RegExp(`^\\s*sub-forge-${kind}:\\s*(\\S+)\\s*$`, 'm'));
      if (!match) return undefined;
      try { return decodeURIComponent(match[1]!); }
      catch (error) {
        if (!recover) throw error;
        notes.push(`已忽略无效的 ${kind} 身份注释：${error instanceof Error ? error.message : String(error)}`);
        return undefined;
      }
    };
    locate(doc.contents);
    if (!isMap(doc.contents)) throw new Error('YAML 顶层必须是对象');
    const referenceNode = doc.get(referenceField, true);
    if (referenceNode !== undefined && !isMap(referenceNode)) throw new Error('规则集引用映射必须是对象');
    const referenceMap = new Map<string, Extract<Matcher, { kind: 'ruleset' }>>();
    if (isMap(referenceNode)) for (const [alias, matcher] of Object.entries(referenceNode.toJSON() as Record<string, unknown>)) {
      if (!matcher || typeof matcher !== 'object' || Array.isArray(matcher) || !('kind' in matcher) || matcher.kind !== 'ruleset' || !('id' in matcher) || typeof matcher.id !== 'string' || !matcher.id.trim()) throw new Error(`规则集「${alias}」引用格式错误`);
      const m = matcher as Extract<Matcher, { kind: 'ruleset' }>;
      if (m.repository && (typeof m.repository.name !== 'string' || typeof m.repository.repo !== 'string' || typeof m.repository.entry !== 'string' || !Array.isArray(m.repository.sources))) throw new Error(`规则集「${alias}」仓库映射格式错误`);
      if (m.remote !== undefined) {
        const remote = remoteRuleMatcher(m.remote?.url);
        if (m.repository || remote.id !== m.id) throw new Error(`规则集「${alias}」远程映射不合法`);
        referenceMap.set(alias, remote);
      } else referenceMap.set(alias, m);
    }
    // 仅展开需要读取的别名；普通节点保留原始注释、稳定 ID 和行号。
    const expand = (node: unknown) => isAlias(node) ? doc.createNode(node.toJS(doc, { maxAliasCount: 100 })) : node;
    const providers = expand(doc.get('rule-providers', true));
    const ruleProviders: NonNullable<TemplateBody['ruleProviders']> = providerOnly ? [...(current.ruleProviders ?? [])] : [];
    const external = new Map<string, Extract<Matcher, { kind: 'ruleset' }>>();
    attempt(() => { if (providers !== undefined && !isMap(providers)) throw new Error('rule-providers 必须是对象'); });
    if (isMap(providers)) for (const item of providers.items) attempt(() => {
      locate(item.value);
      const name = String(item.key);
      if (!name.trim() || name.includes(',')) throw new Error('规则来源名称不能为空或包含逗号');
      const value = expand(item.value);
      const raw = isMap(value) ? value.toJS(doc, { maxAliasCount: 100 }) as Record<string, unknown> : undefined;
      if (!raw || typeof raw.url !== 'string') throw new Error(`规则来源「${name}」缺少远程 URL`);
      const matcher = remoteRuleMatcher(raw.url);
      const mapped = referenceMap.get(name);
      if (mapped?.remote && mapped.remote.url !== matcher.remote!.url) throw new Error(`规则来源「${name}」的 URL 与 ${referenceField} 中的引用不一致，请同步修改或移除该引用映射`);
      // 显式的系统引用映射优先；普通 Clash provider 仅提取 URL。
      if (!referenceMap.has(name)) referenceMap.set(name, matcher);
      external.set(name, matcher);
      const provider = { name, url: matcher.remote!.url };
      const previous = ruleProviders.findIndex(p => p.name === name);
      if (previous < 0) ruleProviders.push(provider);
      else ruleProviders[previous] = provider;
    });
    if (external.size) notes.push(`已读取 ${external.size} 个远程规则 URL，格式自动识别，输出为 LIST`);
    const ignored = doc.contents.items.map((p) => String(p.key)).filter((key) => !['proxy-groups', 'rules', 'rule-providers', referenceField].includes(key));
    if (ignored.length) notes.push(`已忽略：${ignored.join('、')}（仅导入 proxy-groups、rules 和 rule-providers 的 URL）`);
    const groupNodes = expand(doc.get('proxy-groups', true));
    if (isSeq(groupNodes)) groupNodes.items = groupNodes.items.map(node => expand(node) as typeof node);
    locate(groupNodes);
    attempt(() => { if (groupNodes !== undefined && !isSeq(groupNodes)) throw new Error('proxy-groups 必须是列表'); });
    const names = new Map<string, string>();
    const groups: GroupSpec[] = [];
    const usedGroups = new Set<string>();
    const groupByNode = new Map<unknown, GroupSpec>();
    for (const [index, node] of (isSeq(groupNodes) ? groupNodes.items : []).entries()) {
      attempt(() => {
        locate(node);
        if (!isMap(node)) throw new Error('策略组必须是对象');
        const raw = node.toJS(doc, { maxAliasCount: 100 }) as Record<string, unknown>;
        if (typeof raw.name !== 'string' || !raw.name.trim()) {
          if (!recover) throw new Error('策略组缺少有效名称');
          notes.push(`第 ${index + 1} 个策略组缺少有效名称，名称已留空`);
          raw.name = '';
        }
        if (names.has(raw.name as string)) {
          if (!recover) throw new Error(`策略组名称「${raw.name}」重复`);
          notes.push(`第 ${index + 1} 个策略组名称「${raw.name}」重复，重复名称已清空`);
          raw.name = '';
        }
        locate(node.get('type', true) ?? node);
        if (typeof raw.type !== 'string' || !groupTypes.has(raw.type)) {
          if (!recover) throw new Error(`组「${raw.name}」的类型「${String(raw.type)}」不受支持`);
          notes.push(`组「${raw.name}」的类型无效，已使用默认类型 select`);
          raw.type = 'select';
        }
        const tagged = identity(node, 'group', index === 0 ? groupNodes : undefined);
        let old = current.groups.find((g) => g.id === tagged) ?? current.groups.find((g) => g.name === raw.name);
        if (old && usedGroups.has(old.id)) {
          if (!recover) throw new Error(`组「${raw.name}」重复使用同一个稳定 ID，请删除复制项的 sub-forge-group 注释后再导入`);
          notes.push(`组「${raw.name}」已忽略重复的身份注释，分配新的 ID`);
          old = undefined;
        }
        const g: GroupSpec = { id: old?.id ?? newId('g'), name: raw.name as string, type: raw.type as GroupSpec['type'], members: [] };
        usedGroups.add(g.id);
        if (old?.whenEmpty !== undefined) g.whenEmpty = old.whenEmpty;
        if (old?.hint !== undefined) g.hint = old.hint;
        for (const [yamlKey, key] of Object.entries(filterFields)) {
          if (raw[yamlKey] === undefined) continue;
          attempt(() => {
            locate(node.get(yamlKey, true));
            if (typeof raw[yamlKey] !== 'string') throw new Error(`组「${g.name}」的 ${yamlKey} 必须是字符串`);
            g[key] = raw[yamlKey];
          });
        }
        const test: Record<string, unknown> = {};
        for (const [yamlKey, key] of Object.entries(testFields)) {
          if (raw[yamlKey] === undefined) continue;
          attempt(() => {
            locate(node.get(yamlKey, true));
            if (key === 'expectedStatus' && typeof raw[yamlKey] === 'number') {
              test[key] = String(raw[yamlKey]);
              return;
            }
            const expected = key === 'lazy' ? 'boolean' : ['url', 'expectedStatus'].includes(key) ? 'string' : 'number';
            if (typeof raw[yamlKey] !== expected) throw new Error(`组「${g.name}」的 ${yamlKey} 必须是${expected === 'boolean' ? '布尔值' : expected === 'string' ? '字符串' : '数字'}`);
            test[key] = raw[yamlKey];
          });
        }
        if (Object.keys(test).length || old?.test !== undefined) g.test = test;
        if (raw.strategy !== undefined) {
          attempt(() => {
            locate(node.get('strategy', true));
            if (typeof raw.strategy !== 'string' || !['consistent-hashing', 'round-robin', 'sticky-sessions'].includes(raw.strategy)) throw new Error(`组「${g.name}」的 strategy 不受支持`);
            g.strategy = raw.strategy as GroupSpec['strategy'];
          });
        }
        if (raw.hidden !== undefined || raw.icon !== undefined || old?.display !== undefined) {
          g.display = {};
          if (raw.hidden !== undefined) {
            attempt(() => {
              locate(node.get('hidden', true));
              if (typeof raw.hidden !== 'boolean') throw new Error(`组「${g.name}」的 hidden 必须是布尔值`);
              g.display!.hidden = raw.hidden;
            });
          }
          if (raw.icon !== undefined) {
            attempt(() => {
              locate(node.get('icon', true));
              if (typeof raw.icon !== 'string') throw new Error(`组「${g.name}」的 icon 必须是字符串`);
              g.display!.icon = raw.icon;
            });
          }
        }
        const extra: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(raw)) {
          if (nodeField(key)) notes.push(`组「${g.name}」已忽略节点相关字段：${key}`);
          else if (key !== '<<' && !knownFields.has(key)) Object.defineProperty(extra, key, { value, enumerable: true, configurable: true, writable: true });
        }
        if (Object.keys(extra).length || old?.extra !== undefined) g.extra = extra;
        if (g.name.trim()) names.set(g.name, g.id);
        groups.push(g);
        groupByNode.set(node, g);
      });
    }
    const resolve = (name: string): Exclude<Target, { kind: 'node' }> | undefined => {
      const groupId = names.get(name);
      if (groupId !== undefined) return { kind: 'group', groupId };
      if (builtins.has(name)) return { kind: 'builtin', name: name as Builtin };
      return undefined;
    };
    if (isSeq(groupNodes)) groupNodes.items.forEach((node) => {
      if (!isMap(node)) return;
      const group = groupByNode.get(node);
      if (!group) return;
      const raw = node.toJS(doc, { maxAliasCount: 100 }) as Record<string, unknown>;
      const proxies = expand(node.get('proxies', true)) ?? (raw.proxies === undefined ? undefined : doc.createNode(raw.proxies));
      locate(proxies);
      if (proxies === undefined) return;
      if (!isSeq(proxies)) {
        attempt(() => { throw new Error(`组「${group.name}」的 proxies 必须是列表`); });
        return;
      }
      for (const member of proxies.items) {
        attempt(() => {
          locate(member);
          if (!isScalar(member) || typeof member.value !== 'string') throw new Error(`组「${group.name}」的成员必须是名称字符串`);
          const target = resolve(member.value);
          if (target) group.members.push(target);
          else notes.push(`组「${group.name}」已忽略节点成员：${member.value}`);
        });
      }
    });
    const ruleNodes = expand(doc.get('rules', true));
    locate(ruleNodes);
    attempt(() => { if (ruleNodes !== undefined && !isSeq(ruleNodes)) throw new Error('rules 必须是列表'); });
    const rules: RuleEntry[] = [];
    const used = new Set<string>();
    let final: Target | undefined;
    for (const [index, node] of (isSeq(ruleNodes) ? ruleNodes.items : []).entries()) {
      locate(node);
      if (!isScalar(node) || typeof node.value !== 'string') {
        attempt(() => { throw new Error(`第 ${index + 1} 条规则必须是字符串`); });
        continue;
      }
      // 第一项的前置注释可能归在 YAMLSeq 上，而非 Scalar 上。
      const comments = [node.commentBefore, node.comment, index === 0 && isSeq(ruleNodes) ? ruleNodes.commentBefore : undefined];
      if (comments.some((comment) => typeof comment === 'string' && comment.split('\n').some((s) => s.trim() === 'disabled'))) continue;
      const original = node.value;
      try {
        const rawParts = original.split(',');
        const parts = rawParts.map((part) => part.trim());
        const type = parts[0]!.toUpperCase();
        let targetIndex = parts.length - 1;
        while (targetIndex > 0 && ['no-resolve', 'src'].includes(parts[targetIndex]!.toLowerCase())) targetIndex--;
        if (targetIndex < (['MATCH', 'FINAL'].includes(type) ? 1 : 2)) throw new Error('缺少匹配项或出口');
        if (['MATCH', 'FINAL'].includes(type) && final !== undefined) {
          notes.push(`第 ${index + 1} 条 ${type} 已忽略：多条 MATCH / FINAL 仅采用第一条`);
          continue;
        }
        const target = resolve(parts[targetIndex]!);
        if (!target) throw new Error(`出口「${parts[targetIndex]}」未在 proxy-groups 中定义，也不是内置策略；请先补齐同名策略组或更正组名（模板规则不能直接引用单个节点）`);
        const matchingParts = parts.filter((_, i) => i !== targetIndex);
        const matchingText = rawParts.filter((_, i) => i !== targetIndex).join(',').trim();
        const flags = parts.slice(targetIndex + 1).map(part => part.toLowerCase());
        if (['MATCH', 'FINAL'].includes(type)) {
          final = target;
          continue;
        }
        const tagged = identity(node, 'rule', index === 0 ? ruleNodes : undefined);
        const byId = current.rules.find((r) => r.id === tagged);
        let matcher: Matcher;
        if (type === 'RULE-SET') {
          const name = parts[1]!;
          const reference = referenceMap.get(name);
          const matches = ctx.rulesets.filter(ref => ref.name === name);
          const ruleset = matches[0];
          if (reference) matcher = reference;
          else if (matches.length > 1) throw new Error(`规则集「${name}」重名，请在表单中选择或保留引用映射`);
          else if (ruleset) matcher = { kind: 'ruleset', id: ruleset.id };
          else throw new Error(`规则集「${name}」不存在`);
        } else {
          if (byId?.matcher.kind === 'rule' && byId.matcher.rule.type === 'RAW') {
            matcher = { kind: 'rule', rule: { ...byId.matcher.rule, text: matchingText } };
          } else {
            try { matcher = { kind: 'rule', rule: parseRuleLine(matchingParts.join(',')) }; }
            catch (error) {
              if (!(error instanceof UnsupportedRuleError)) throw error;
              // 未纳入 IR 的语法原样保留，不因表单/YAML 切换丢失自定义规则。
              matcher = { kind: 'rule', rule: { type: 'RAW', text: matchingText } };
            }
          }
        }
        if (!(matcher.kind === 'rule' && matcher.rule.type === 'RAW') && matchingParts.slice(2).some(part => !['no-resolve', 'src'].includes(part.toLowerCase()))) throw new Error('规则包含多余字段或不支持的选项');
        const key = matcherKey(matcher);
        if (byId && used.has(byId.id)) {
          if (!recover) throw new Error('重复使用同一个稳定 ID，请删除复制项的 sub-forge-rule 注释后再导入');
          notes.push(`第 ${index + 1} 条规则已忽略重复的身份注释`);
        }
        const old = (byId && !used.has(byId.id) ? byId : undefined) ?? current.rules.find((r) => !used.has(r.id) && matcherKey(r.matcher) === key);
        if (old) used.add(old.id);
        const r: RuleEntry = { id: old?.id ?? newId('r'), ...restoreRule(matcher, old, flags.includes('no-resolve'), flags.includes('src')), target };
        if (type === 'RULE-SET' && matcher.kind === 'ruleset' && ruleProviders.some(p => p.name === parts[1] && p.url === matcher.remote?.url)) r.providerName = parts[1]!;
        rules.push(r);
      } catch (err) {
        const message = `第 ${index + 1} 条规则「${original}」：${err instanceof Error ? err.message : String(err)}`;
        if (!recover) throw new Error(message);
        notes.push(`已忽略 ${message}`);
      }
    }
    if (providerOnly) {
      for (const [name, matcher] of external) {
        if (rules.some(rule => matcherKey(rule.matcher) === matcherKey(matcher))) continue;
        rules.push({ id: newId('r'), matcher, providerName: name, target: { kind: 'builtin', name: 'REJECT' } });
      }
      if (external.size) notes.push('远程规则已补入当前模板，新规则出口默认为 REJECT，请按需调整');
    }
    const unused = ruleProviders.filter(p => !rules.some(r => r.matcher.kind === 'ruleset' && r.matcher.remote?.url === p.url));
    if (unused.length) notes.push(`已保留 ${unused.length} 个未引用的远程规则来源：${unused.map(p => p.name).join('、')}；未添加分流规则`);
    if (final === undefined) {
      const previousFinal = current.final;
      if (recover && previousFinal.kind === 'group' && !groups.some((group) => group.id === previousFinal.groupId)) {
        final = { kind: 'builtin', name: 'REJECT' };
        notes.push('未找到有效的 MATCH / FINAL，原出口组已不存在，出口已设为 REJECT');
      } else notes.push('未找到 MATCH / FINAL，已沿用当前模板的 final 出口');
    }
    return { ok: true, value: { groups, rules, final: final ?? current.final, ...(ruleProviders.length ? { ruleProviders } : {}) }, notes };
  } catch (err) {
    return { ok: false, error: `模板 YAML 导入失败：${err instanceof Error ? err.message : String(err)}`, ...(line === undefined ? {} : { line }) };
  }
}
