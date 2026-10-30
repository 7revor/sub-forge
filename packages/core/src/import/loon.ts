import { remoteRuleMatcher } from '../rules/remote.ts';
import type { Collection, GroupMember, GroupSpec, LocalProxyGroup, Profile, Source, Target } from '../types.ts';
import { Report, type ReportItem } from '../report.ts';
import { stripIniComment, iniName } from '../render/ini-format.ts';
import { validateNativeText, type ProfileBase } from '../base/native.ts';
import { parseLoonLine } from '../proxy/loon.ts';
import { splitRuleFields } from '../rules/syntax.ts';
import { parseRuleLine } from '../rules/parse.ts';
import { compileUserRegex, exactNameRegex } from '../util/regex.ts';
import { findGroupCycles } from '../template/merge.ts';

type Row = { text: string; line: number };
export type LoonImport = {
  profile: Profile & { base: ProfileBase };
  sources: Source[]; collections: Collection[]; locals: LocalProxyGroup[];
  report: ReportItem[];
};
const decode = (s: string) => s.startsWith('"') ? String(JSON.parse(s)) : s;
const options = (parts: string[]) => {
  const out: Record<string,string> = Object.create(null);
  for (const part of parts) {
    const at = part.indexOf('='); if (at < 1) throw new Error('参数必须使用 字段=值');
    const key = part.slice(0, at).trim().toLowerCase(); if (Object.hasOwn(out, key)) throw new Error('重复参数：' + key);
    out[key] = decode(part.slice(at + 1).trim());
  }
  return out;
};
const bool = (v: string) => { if (!['true', 'false'].includes(v)) throw new Error('需要 true 或 false'); return v === 'true'; };
const number = (v: string) => { const n = Number(v); if (!v || !Number.isFinite(n) || n < 0) throw new Error('需要非负数字'); return n; };

/** 纯导入规划：不联网、不落库。所有引用只允许指向这次导入声明的资源。 */
export function importLoonConfig(text: string, opts: { id: string; name: string; final?: string }): LoonImport {
  const report = new Report(), sections = new Map<string, Row[]>();
  let section = '';
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = stripIniComment(raw).trim(); if (!line) return;
    const match = /^\[([^\]]+)\]$/.exec(line);
    if (match) { section = match[1]!.toLowerCase(); if (!sections.has(section)) sections.set(section, []); return; }
    if (!section) { report.error('loon.import-section', '配置正文需要段落标题', 'line:' + (index + 1)); return; }
    sections.get(section)!.push({ text: line, line: index + 1 });
  });
  const supported = ['general', 'host', 'proxy', 'remote proxy', 'proxy chain', 'proxy group', 'remote filter', 'rule', 'remote rule'];
  for (const [name, rows] of sections) if (!supported.includes(name) && rows.length) report.error('loon.import-section', '[' + name + '] 尚未适配，不能丢弃此段后导入');
  let serial = 0; const id = () => opts.id + '-' + ++serial;
  const locals: LocalProxyGroup[] = [{ id: id(), name: opts.name + '_本地节点', proxies: [] }], local = locals[0]!;
  const sources: Source[] = [], collections: Collection[] = [], groups: GroupSpec[] = [];
  const profile: LoonImport['profile'] = { id: opts.id, name: opts.name, nodeSets: [], chains: [], overlay: {}, refPolicy: { default: 'wrap' }, routing: { mode: 'independent', config: { groups, rules: [], final: { kind: 'builtin', name: 'REJECT' } } }, base: {} };
  const config = profile.routing!.mode === 'independent' ? profile.routing!.config : null!;
  const run = (name: string, fn: (row: Row) => void) => {
    for (const row of sections.get(name) ?? []) try { fn(row); } catch (error) { report.error('loon.import-invalid', '[' + name + '] ' + (error instanceof Error ? error.message : '内容不合法'), 'line:' + row.line); }
  };
  const declared = new Set<string>(['DIRECT', 'REJECT', 'REJECT-DROP']);
  const named = (row: Row) => {
    const at = row.text.indexOf('='); if (at < 1) throw new Error('需要 名称=内容');
    const name = iniName(row.text.slice(0, at).trim());
    if (declared.has(name)) throw new Error('名称重复或与内置策略冲突：' + name);
    declared.add(name); return { name, fields: splitRuleFields(row.text.slice(at + 1), false) };
  };
  try {
    let inBase = false;
    const base = text.split(/\r?\n/).filter(line => {
      const heading = /^\[([^\]]+)\]$/.exec(stripIniComment(line).trim());
      if (heading) inBase = ['general', 'host'].includes(heading[1]!.toLowerCase());
      return inBase;
    }).join('\n');
    validateNativeText(base, 'loon');
    profile.base = { kernels: { loon: base } };
  } catch (error) { report.error('loon.import-base', (error as Error).message); }
  run('proxy', row => { const { name } = named(row); const proxy = parseLoonLine(row.text); local.proxies.push({ ...proxy, name }); });
  const remote = new Map<string, Source>(), active = new Set<string>();
  run('remote proxy', row => {
    const { name, fields } = named(row), kv = options(fields.slice(1));
    const url = decode(fields[0] ?? ''); if (!/^https?:\/\/[^\s]+$/.test(url)) throw new Error('远程订阅需要 HTTP(S) 地址');
    const source: Source = { id: id(), name, url, pipeline: [] };
    const patch: Record<string, unknown> = {};
    for (const [k,v] of Object.entries(kv)) {
      if (['udp', 'block-quic', 'skip-cert-verify', 'fast-open'].includes(k)) { if (v !== 'default') patch[k === 'fast-open' ? 'tfo' : k] = bool(v); }
      else if (k === 'vmess-aead') { if (!bool(v)) throw new Error('非 AEAD VMess 无法等价表达，请调整 vmess-aead'); source.pipeline.push({ op: 'set', types: ['vmess'], fields: { alterId: 0 } }); }
      else if (k === 'enabled') bool(v);
      else if (k === 'flexible-sni') { if (bool(v)) throw new Error('flexible-sni=true 尚未适配'); }
      else if (k === 'img-url') source.note = 'Loon 来源图标：' + v;
      else throw new Error('未适配的远程订阅参数：' + k);
    }
    if (Object.keys(patch).length) source.pipeline.push({ op: 'set', fields: patch });
    remote.set(name, source); sources.push(source); if (kv.enabled !== 'false') active.add(source.id);
    else report.info('loon.import-disabled-source', '已保存停用的远程来源，但未加入本订阅', 'source:' + source.id);
  });
  const filterRefs = new Map<string, string>(), unavailableFilters = new Set<string>();
  run('remote filter', row => {
    const { name, fields } = named(row), kv = options(fields.slice(1));
    if (fields[0]!.toLowerCase() === 'nodeselect') { unavailableFilters.add(name); report.warn('loon.import-manual-filter', '手动 NodeSelect 筛选器「' + name + '」未包含可移植的选择结果；被引用时需先改为明确节点或 NameRegex'); return; }
    if (fields[0]!.toLowerCase() !== 'nameregex' || kv.filterkey === undefined || Object.keys(kv).some(k => k !== 'filterkey')) throw new Error('目前支持 NameRegex + FilterKey');
    compileUserRegex(kv.filterkey);
    const collection: Collection = { id: id(), name, members: sources.filter(s => active.has(s.id)).map(s => ({ ref: { type: 'source', id: s.id } })), pipeline: [{ op: 'filter.regex', patterns: [kv.filterkey], keep: true }] };
    collections.push(collection); filterRefs.set(name, collection.id);
  });
  const groupRows: { group: GroupSpec; members: string[]; row: Row }[] = [];
  run('proxy group', row => {
    const { name, fields } = named(row), type = fields.shift()!.toLowerCase();
    if (!['select', 'url-test', 'fallback', 'load-balance'].includes(type)) throw new Error('未适配的策略组类型：' + type);
    const members = fields.filter(f => !f.includes('=')), kv = options(fields.filter(f => f.includes('=')));
    const group: GroupSpec = { id: id(), name, type: type as GroupSpec['type'], members: [] };
    for (const [k,v] of Object.entries(kv)) {
      if (k === 'img-url') group.display = { icon: v };
      else if (k === 'algorithm') { if (!['PCC', 'Round-Robin'].includes(v)) throw new Error('不支持此负载均衡算法'); group.strategy = v === 'PCC' ? 'consistent-hashing' : 'round-robin'; }
      else if (['url', 'interval', 'tolerance', 'max-timeout'].includes(k)) (group.test ??= {})[k === 'max-timeout' ? 'maxTimeout' : k as 'url'] = (k === 'url' ? v : number(v)) as never;
      else throw new Error('未适配的策略组参数：' + k);
    }
    groups.push(group); groupRows.push({ group, members, row });
  });
  const chainRows: { name: string; hops: string[]; udp?: boolean; row: Row }[] = [];
  run('proxy chain', row => {
    const { name, fields } = named(row), hops = fields.filter(f => !f.includes('=')), kv = options(fields.filter(f => f.includes('=')));
    if (hops.length !== 2) throw new Error('当前支持两跳命名代理链；多跳链需要拆成明确的两跳出口后导入');
    if (Object.keys(kv).some(k => k !== 'udp')) throw new Error('代理链仅适配 udp 参数');
    const landing = local.proxies.find(p => p.name === hops[1]); if (!landing) throw new Error('链落地需要是本配置 [Proxy] 中的节点');
    const udp = kv.udp === undefined ? undefined : bool(kv.udp);
    if (udp === true && landing.udp === false) throw new Error('链要求 UDP，但落地节点显式禁用了 UDP');
    local.proxies.push({ ...structuredClone(landing), name, ...(udp === undefined ? {} : { udp }) });
    chainRows.push({ name, hops, udp, row });
  });
  const target = (name: string): Target => {
    if (['DIRECT', 'REJECT', 'REJECT-DROP'].includes(name)) return { kind: 'builtin', name: name as 'DIRECT' };
    const group = groups.find(g => g.name === name); if (group) return { kind: 'group', groupId: group.id };
    if (local.proxies.some(p => p.name === name)) return { kind: 'node', ref: { nodeSet: { type: 'local', id: local.id }, match: { exact: name } } };
    throw new Error('找不到出口「' + name + '」，远程动态节点请通过筛选器和策略组引用');
  };
  const member = (name: string): GroupMember => {
    const filter = filterRefs.get(name); if (filter) return { kind: 'nodeset', ref: { type: 'collection', id: filter } };
    if (unavailableFilters.has(name)) throw new Error('NodeSelect 筛选器「' + name + '」缺少选择结果');
    const source = remote.get(name); if (source) { if (!active.has(source.id)) throw new Error('不能引用停用的远程来源'); return { kind: 'nodeset', ref: { type: 'source', id: source.id } }; }
    return target(name);
  };
  for (const { group, members, row } of groupRows) for (const name of members) try { group.members.push(member(name)); } catch (error) { report.error('loon.import-reference', (error as Error).message, 'line:' + row.line); }
  for (const chain of chainRows) try {
    profile.chains.push({ id: id(), landing: { nodeSet: { type: 'local', id: local.id }, filter: exactNameRegex(chain.name) }, via: target(chain.hops[0]!) });
  } catch (error) { report.error('loon.import-reference', (error as Error).message, 'line:' + chain.row.line); }
  let finalSeen = false;
  run('rule', row => {
    const fields = splitRuleFields(row.text), kind = fields[0]!.toUpperCase();
    if (kind === 'FINAL') { if (finalSeen || fields.length !== 2) throw new Error('FINAL 必须唯一且仅包含出口'); config.final = target(fields[1]!); finalSeen = true; return; }
    if (finalSeen) throw new Error('FINAL 后存在规则，无法保持可达性');
    const at = ['AND', 'OR', 'NOT'].includes(kind) ? fields.length - 1 : 2;
    const destination = fields.splice(at, 1)[0]; if (!destination) throw new Error('规则缺少出口');
    const rule = parseRuleLine(fields.join(',')); config.rules.push({ id: id(), matcher: { kind: 'rule', rule }, target: target(destination) });
  });
  run('remote rule', row => {
    const fields = splitRuleFields(row.text, false), kv = options(fields.slice(1));
    if (!/^https?:\/\/[^\s]+$/.test(fields[0]!) || !kv.policy) throw new Error('远程规则需要 HTTP(S) 地址和 policy');
    for (const k of Object.keys(kv)) if (!['policy', 'tag', 'enabled'].includes(k)) throw new Error('未适配远程规则参数：' + k);
    if (kv.enabled !== undefined && !bool(kv.enabled)) { report.warn('loon.import-disabled-rule', '停用的远程规则未加入当前分流', 'line:' + row.line); return; }
    const rid = id(); config.rules.push({ id: rid, matcher: remoteRuleMatcher(fields[0]!), target: target(kv.policy) });
    report.warn('loon.import-rule-priority', '远程规则将内嵌在本地规则后；请核对 Loon 域名/IP 分阶段匹配的优先级', 'line:' + row.line);
  });
  if (!finalSeen) {
    if (opts.final) try { config.final = target(opts.final); report.warn('loon.import-final-selected', '原文没有 FINAL，已使用明确选择的最终出口'); } catch (error) { report.error('loon.import-final', (error as Error).message); }
    else report.error('loon.import-final', '原文未提供 FINAL，请补充 [Rule] FINAL 或明确选择最终出口');
  }
  for (const cycle of findGroupCycles(groups)) report.error('loon.import-cycle', '策略组引用成环：' + cycle.join(' → '));
  if (local.proxies.length) profile.nodeSets.push({ ref: { type: 'local', id: local.id }, output: 'inline' });
  else locals.length = 0;
  for (const source of sources.filter(s => active.has(s.id))) profile.nodeSets.push({ ref: { type: 'source', id: source.id }, output: 'provider' });
  for (const collection of collections) profile.nodeSets.push({ ref: { type: 'collection', id: collection.id }, output: 'provider' });
  return { profile, sources, collections, locals, report: report.items };
}
