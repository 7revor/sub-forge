import { stringifyIniBase, localRulesError } from '@sub-forge/core';
import { normalizeRulePresence } from '../rule-presence.ts';
import { validateProfileRouting } from './profile-routing-validation.ts';
import { isIndexedRuleFile } from '../rule-repos/generic.ts';
import { rawUrl, type IndexedEntry, type RepoDefinition } from '../rule-repos/adapters.ts';
// 保存前的校验：结构必填项、正则能否编译、引用是否存在且属于当前用户、组合是否成环。
// 深层结构（规则、组参数等）由渲染报告兜住，这里只拦截保存后必然无法使用的数据。

import { compileUserRegex, findCollectionCycles, isYamlRuleUrl, rawRuleError, type Collection, type NodeSetID } from '@sub-forge/core';
import type { DocKind, DocTypes, RuleSetDoc } from '../docs.ts';
import type { Store, User } from '../store.ts';
import { normalizeRuleSet, promoteRuleSetOverrides } from '../legacy-rules.ts';
import { normalizeSourceFetch, sourceUrl } from '../source-url.ts';
import { bad, isStr } from './common.ts';
import { checkRuleSetReference, type RuleSetMatcher } from '../ruleset-reference.ts';

const OPS = new Set(['filter.regex', 'filter.type', 'filter.useless', 'rename.regex', 'rename.delete', 'rename.affix', 'flag', 'sort.name', 'sort.regex', 'dedupe', 'set', 'script']);
const RULESET_FORMATS = new Set(['auto', 'classical', 'domain', 'ipcidr', 'domain-set', 'yaml', 'mrs', 'srs']);
const NODESET_KINDS = new Set(['source', 'collection', 'local']);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isHttpUrl = (v: unknown) => { if (typeof v !== 'string') return false; try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; } };

/** 替换、丢弃接受内容匹配，追加无需匹配；预览与保存共用校验。 */
export function checkRuleSetOverrides(value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) throw bad('客户端改写必须是数组');
  const rule = (r: unknown): boolean => {
    if (!isObj(r) || (r.extendedMatching !== undefined && typeof r.extendedMatching !== 'boolean')) return false;
    if (r.type === 'RAW') return (r.client === undefined || ['mihomo', 'surge', 'stash', 'loon'].includes(r.client as string)) && typeof r.text === 'string' && !rawRuleError(r.text);
    if (['AND', 'OR', 'NOT'].includes(r.type as string)) return Array.isArray(r.children) && r.children.length > 0 && r.children.every(rule);
    if (r.type === 'PROCESS') return ['name', 'path'].includes(r.kind as string) && ['exact', 'wildcard', 'regex'].includes(r.mode as string) && isStr(r.value);
    if (r.type === 'NETWORK') return r.value === 'tcp' || r.value === 'udp';
    return ['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'DOMAIN-WILDCARD', 'DOMAIN-REGEX', 'USER-AGENT', 'URL-REGEX', 'IP-CIDR', 'IP-CIDR6', 'IP-ASN', 'SRC-IP-CIDR', 'GEOSITE', 'GEOIP', 'DST-PORT', 'SRC-PORT'].includes(r.type as string) && isStr(r.value);
  };
  value.forEach((item, i) => {
    const at = `客户端改写第 ${i + 1} 条`;
    if (!isObj(item) || item.line !== undefined) throw bad(`${at}：只支持规则内容匹配，请填写完整规则内容`);
    const o = item.override;
    if (!isObj(o) || !isObj(o.when) || !['mihomo', 'surge', 'stash', 'loon'].includes(o.when.client as string) || (o.when.platform !== undefined && !['android', 'macos', 'windows', 'ios', 'linux'].includes(o.when.platform as string))) throw bad(`${at}：客户端或平台不合法`);
    const a = o.action;
    if (!isObj(a) || !(
      a.drop === true && a.replace === undefined && a.append === undefined ||
      a.drop === undefined && a.append === undefined && Array.isArray(a.replace) && a.replace.length > 0 && a.replace.every(rule) ||
      a.drop === undefined && a.replace === undefined && Array.isArray(a.append) && a.append.length > 0 && a.append.every(rule)
    )) throw bad(`${at}：请选择丢弃或填写完整的替换、追加规则`);
    if (a.append !== undefined) {
      if (item.match !== undefined) throw bad(`${at}：追加无需规则内容匹配`);
    } else if (!isStr(item.match)) throw bad(`${at}：请填写完整规则内容`);
  });
}

function checkRegex(pattern: unknown, where: string, flags = ''): void {
  if (typeof pattern !== 'string') throw bad(`${where}：正则必须是字符串`);
  try { compileUserRegex(pattern, flags); } catch (e) { throw bad(`${where}：${(e as Error).message}`); }
}

/** 不限制 RAW 的规则类型，但单条编辑不能注入额外规则行。 */
function checkRawRules(value: unknown, where: string): void {
  if (Array.isArray(value)) { value.forEach(item => checkRawRules(item, where)); return; }
  if (!isObj(value)) return;
  if (value.kind === 'local') {
    const error = localRulesError(value);
    if (error) throw bad(`${where}：${error}`);
  }
  if (value.type === 'RAW') {
    if (value.client !== undefined && !['mihomo', 'surge', 'stash', 'loon'].includes(value.client as string)) throw bad(`${where}：RAW 客户端不合法`);
    if (typeof value.text !== 'string') throw bad(`${where}：RAW 内容必须是字符串`);
    const error = rawRuleError(value.text);
    if (error) throw bad(`${where}：${error}`);
  }
  for (const key of ['matcher', 'rule', 'overrides', 'action', 'replace', 'append', 'children']) checkRawRules(value[key], where);
}

export function checkFetch(fetch: unknown, source = false): void {
  if (fetch === undefined) return;
  if (!isObj(fetch)) throw bad('拉取参数格式错误');
  if (!source && fetch.ua !== undefined && typeof fetch.ua !== 'string') throw bad('User-Agent 必须是字符串');
  if (!source && fetch.timeoutMs !== undefined && !(typeof fetch.timeoutMs === 'number' && Number.isSafeInteger(fetch.timeoutMs) && fetch.timeoutMs > 0 && fetch.timeoutMs <= 4294967295)) throw bad('超时必须是正整数毫秒，且不超过 4294967295');
}

function checkPipeline(steps: unknown, where: string, user: User): void {
  if (!Array.isArray(steps)) throw bad(`${where}：pipeline 必须是数组`);
  steps.forEach((s: unknown, i) => {
    const at = `${where} 第 ${i + 1} 步`;
    if (!isObj(s) || typeof s.op !== 'string' || !OPS.has(s.op)) throw bad(`${at}：未知的处理器`);
    if (s.enabled !== undefined && typeof s.enabled !== 'boolean') throw bad(`${at}：enabled 必须是布尔值`);
    const string = (value: unknown, key: string, optional = false) => {
      if (!(optional && value === undefined) && typeof value !== 'string') throw bad(`${at}：${key} 必须是字符串`);
    };
    const choice = (value: unknown, values: string[], key: string, optional = false) => {
      if (!(optional && value === undefined) && !values.includes(value as string)) throw bad(`${at}：${key} 只能是 ${values.join(' / ')}`);
    };
    const patterns = (value: unknown) => {
      if (!Array.isArray(value)) throw bad(`${at}：patterns 必须是数组`);
      value.forEach((p, j) => checkRegex(p, `${at} patterns[${j}]`));
    };
    switch (s.op) {
      case 'filter.regex':
        patterns(s.patterns);
        if (typeof s.keep !== 'boolean') throw bad(`${at}：keep 必须是布尔值`);
        break;
      case 'sort.regex': case 'rename.delete':
        patterns(s.patterns); break;
      case 'filter.useless':
        if (s.patterns !== undefined) patterns(s.patterns);
        break;
      case 'filter.type':
        if (!Array.isArray(s.types) || !s.types.every(t => typeof t === 'string')) throw bad(`${at}：types 必须是字符串数组`);
        if (typeof s.keep !== 'boolean') throw bad(`${at}：keep 必须是布尔值`);
        break;
      case 'rename.regex':
        if (!Array.isArray(s.rules)) throw bad(`${at}：rules 必须是数组`);
        s.rules.forEach((r: unknown, j: number) => {
          if (!isObj(r)) throw bad(`${at}：rules[${j}] 必须是对象`);
          string(r.replace, `rules[${j}].replace`);
          string(r.flags, `rules[${j}].flags`, true);
          checkRegex(r.pattern, `${at} rules[${j}].pattern`, ((r.flags as string | undefined) ?? '').replace('g', '') + 'g');
        });
        break;
      case 'rename.affix':
        string(s.prefix, 'prefix', true); string(s.suffix, 'suffix', true); break;
      case 'flag': choice(s.mode, ['add', 'remove'], 'mode'); break;
      case 'sort.name': choice(s.order, ['asc', 'desc'], 'order'); break;
      case 'dedupe':
        choice(s.strategy, ['suffix', 'drop'], 'strategy'); choice(s.by, ['name', 'key'], 'by', true); break;
      case 'set':
        if (!isObj(s.fields)) throw bad(`${at}：fields 必须是对象`);
        if (Object.keys(s.fields).some(k => ['name', 'type', 'server', 'port'].includes(k) || k.startsWith('_'))) throw bad(`${at}：fields 不能修改节点身份或隐式字段`);
        break;
      case 'script':
        if (!(user.role === 'admin' || user.scriptAllowed)) throw bad(`${at}：没有编写脚本的权限（SRC-08）`);
        string(s.code, 'code'); break;
    }
  });
}

export class RefChecker {
  constructor(private readonly store: Store, private readonly user: User) {}

  owned(kind: DocKind, id: string): boolean {
    const row = this.store.getWithOwner(kind, id);
    return !!row && row.owner === this.user.id;
  }

  /** 规则集：自己的，或管理员名下的公共规则集（模板由管理员维护，会引用这些） */
  ruleVisible(id: string): boolean {
    const row = this.store.getWithOwner('ruleset', id);
    if (!row) return false;
    if (row.owner === this.user.id) return true;
    return row.owner !== null && this.store.getUser(row.owner)?.role === 'admin';
  }

  nodeSet(ref: unknown, where: string): NodeSetID {
    if (!isObj(ref) || !NODESET_KINDS.has(ref.type as string) || !isStr(ref.id)) throw bad(`${where}：节点集引用格式错误`);
    const r = ref as NodeSetID;
    if (!this.owned(r.type, r.id)) throw bad(`${where}：节点集 ${r.type}:${r.id} 不存在`);
    return r;
  }

  target(t: unknown, where: string): void {
    if (!isObj(t)) throw bad(`${where}：出口格式错误`);
    if (t.kind === 'builtin' || t.kind === 'group') return;
    if (t.kind === 'node' && isObj(t.ref)) { this.nodeSet(t.ref.nodeSet, where); return; }
    throw bad(`${where}：出口格式错误`);
  }
}

/** 草稿预览与持久化共用仓库关联约束；不限制普通远程来源输入中的未完成地址。 */
export function checkRepositorySource(src: Record<string, unknown>, prior: { repository?: unknown; url?: string; format?: string } | undefined, store: Store, at: string) {
  if ((src.format === 'mrs' || src.format === 'srs') && typeof src.url === 'string' && (isYamlRuleUrl(src.url) || (prior?.url === src.url && prior.format === 'yaml'))) throw bad(`${at}：YAML 规则只能自动转换为 LIST 托管，不能透传`);
  const link = src.repository;
  const sameLink = (a: unknown, b: unknown) => isObj(a) && isObj(b) && ['repo', 'entry', 'ref', 'path'].every(k => a[k] === b[k]);
  if (prior?.repository && (!sameLink(link, prior.repository) || src.kind !== 'remote' || src.url !== prior.url)) throw bad(`${at}：关联来源的地址不可修改，请删除后重新关联`);
  if (link !== undefined) {
    if (src.kind !== 'remote' || !isObj(link) || !['repo', 'entry', 'ref', 'path'].every(k => isStr(link[k]))) throw bad(`${at}：仓库关联标识不合法`);
    // 已保存关联可继续使用，停用仓库或上游删文件不会阻断其他配置的保存。
    if (!prior?.repository) {
      const config = store.db.prepare('SELECT COALESCE(indexed_definition, definition) AS definition FROM rule_repos WHERE id = ?').get(link.repo) as { definition: string | null } | undefined;
      const repo = config?.definition ? JSON.parse(config.definition) as RepoDefinition : undefined;
      const row = store.db.prepare('SELECT e.data FROM rule_repo_entries e JOIN rule_repos r ON r.id = e.repo WHERE e.repo = ? AND e.key = ? AND r.enabled = 1').get(link.repo, link.entry) as { data: string } | undefined;
      const entry = row ? JSON.parse(row.data) as IndexedEntry : undefined;
      const file = entry?.variants.flatMap(v => v.files).find(f => f.path === link.path && f.ref === link.ref);
      if (!repo || !file || !isIndexedRuleFile(file.path) || ['yaml', 'mrs', 'srs'].includes(file.format) || src.url !== rawUrl(repo, file)) throw bad(`${at}：关联地址必须与仓库索引一致`);
    }
    src.repository = { repo: link.repo, entry: link.entry, ref: link.ref, path: link.path };
  }
}

/** 校验并返回规范化后的文档（id 由调用方确定） */
export function validateDoc<K extends DocKind>(kind: K, body: Record<string, unknown>, id: string, user: User, store: Store): DocTypes[K] {
  if (!isStr(body.name)) throw bad('name 不能为空');
  if (['source', 'collection', 'local', 'ruleset'].includes(kind) && body.note !== undefined && typeof body.note !== 'string') throw bad('备注必须是字符串');
  const doc = normalizeRulePresence(kind, { ...body, id }) as Record<string, unknown>;
  const refs = new RefChecker(store, user);

  switch (kind) {
    case 'source': {
      // 订阅源只有远程一种；手写或粘贴的节点放在本地节点组。旧客户端带的 kind: 'remote' 直接去掉
      if (doc.kind !== undefined && doc.kind !== 'remote') throw bad('订阅源只支持远程地址，粘贴的节点请放到本地节点组');
      delete doc.kind;
      if (doc.content !== undefined) throw bad('订阅源不再支持 content，粘贴的节点请放到本地节点组');
      try { doc.url = sourceUrl(doc); } catch (e) { throw bad((e as Error).message); }
      delete doc.urls;
      checkFetch(doc.fetch, true);
      const normalized = normalizeSourceFetch(doc as { fetch?: { ttlSec?: number } });
      delete doc.fetch;
      if (normalized.fetch) doc.fetch = normalized.fetch;
      if (doc.pipeline === undefined) doc.pipeline = [];
      checkPipeline(doc.pipeline, '处理链', user);
      break;
    }
    case 'collection': {
      if (!Array.isArray(doc.members)) throw bad('members 必须是数组');
      (doc.members as unknown[]).forEach((m, i) => {
        if (!isObj(m)) throw bad(`成员 ${i + 1} 格式错误`);
        refs.nodeSet(m.ref, `成员 ${i + 1}`);
      });
      if (doc.pipeline === undefined) doc.pipeline = [];
      checkPipeline(doc.pipeline, '处理链', user);
      // 组合引用图必须是 DAG（COL-04）：用当前用户的全部组合 + 本次修改检测
      const all: Record<string, Collection> = Object.fromEntries(store.list('collection', user.id).map((c) => [c.id, c]));
      all[id] = doc as unknown as Collection;
      const cycles = findCollectionCycles(all).filter((c) => c.includes(id));
      if (cycles.length) throw bad(`组合引用成环：${cycles[0]!.join(' → ')}`);
      break;
    }
    case 'local': {
      if (!Array.isArray(doc.proxies)) throw bad('proxies 必须是数组');
      (doc.proxies as unknown[]).forEach((p, i) => {
        const port = isObj(p) ? Number(p.port) : NaN;
        if (!isObj(p) || !isStr(p.name) || !isStr(p.type) || !isStr(p.server) || !(port > 0 && port < 65536)) throw bad(`节点 ${i + 1} 缺少 name / type / server / port`);
        // 本地节点只录入节点信息，代理链统一在配置订阅的链规则中设置
        for (const key of ['dialer', 'dialer-proxy', 'underlying-proxy']) {
          if (p[key] !== undefined) throw bad(`节点「${p.name}」不能设置 ${key}：本地节点不处理代理链，请在配置订阅的「代理链」中添加链规则`);
        }
      });
      break;
    }
    case 'ruleset': {
      // 兼容旧客户端的单一来源写法（kind / url / content 平铺）
      if (doc.sources === undefined && doc.kind !== undefined) {
        const normalized = normalizeRuleSet(doc);
        delete doc.overrides;
        Object.assign(doc, normalized, { id });
      }
      for (const k of ['kind', 'url', 'content', 'format', 'behavior', 'fetch']) delete doc[k];
      if (!Array.isArray(doc.sources)) throw bad('sources 必须是数组');
      checkRuleSetOverrides(doc.overrides);
      if (doc.noResolve !== undefined && typeof doc.noResolve !== 'boolean') throw bad('noResolve 必须是布尔值');
      const previous = store.getWithOwner('ruleset', id);
      const priorSources = previous?.owner === user.id ? previous.doc.sources : [];
      const ids = new Set<string>();
      (doc.sources as unknown[]).forEach((src, i) => {
        const at = `来源 ${i + 1}`;
        if (!isObj(src) || !isStr(src.id)) throw bad(`${at}：缺少 id`);
        if (ids.has(src.id)) throw bad(`${at}：id ${src.id} 重复`);
        ids.add(src.id);
        const prior = priorSources.find(s => s.id === src.id);
        checkRepositorySource(src, prior, store, at);
        src.format ??= 'auto';
        if (!RULESET_FORMATS.has(src.format as string)) throw bad(`${at}：format 不合法`);
        if (src.kind === 'remote') { if (!isHttpUrl(src.url)) throw bad(`${at}：远程来源需要 http(s) 地址`); delete src.content; }
        else if (src.kind === 'local') { if (typeof src.content !== 'string') throw bad(`${at}：本地来源需要 content`); delete src.url; delete src.fetch; }
        else throw bad(`${at}：kind 只能是 remote 或 local`);
        if (src.name !== undefined && typeof src.name !== 'string') throw bad(`${at}：name 必须是字符串`);
        if (src.enabled !== undefined && typeof src.enabled !== 'boolean') throw bad(`${at}：enabled 必须是布尔值`);
        checkFetch(src.fetch);
        if (src.format === 'mrs' && src.behavior !== 'domain' && src.behavior !== 'ipcidr') throw bad(`${at}：mrs 需要声明 behavior 为 domain 或 ipcidr`);
        if (src.overrides !== undefined && !Array.isArray(src.overrides)) throw bad(`${at}：overrides 必须是数组`);
      });
      Object.assign(doc, promoteRuleSetOverrides(doc as unknown as RuleSetDoc, (src) => src.url ? store.latestSnapshot('ruleset', id, src.url)?.body : undefined));
      break;
    }
    case 'preset': {
      if (!isObj(doc.mihomo)) throw bad('mihomo 段必须是对象');
      if (doc.stash !== undefined && !isObj(doc.stash)) throw bad('stash 段必须是对象');
      for (const client of ['surge', 'loon']) if (doc[client] !== undefined) {
        if (!isObj(doc[client])) throw bad(client + ' 段必须是对象');
        try { stringifyIniBase(doc[client]); } catch (error) { throw bad(error instanceof Error ? error.message : '基础设置不合法'); }
      }
      if (typeof doc.version !== 'number') doc.version = 1;
      break;
    }
    case 'profile': {
      delete doc.revision;
      delete doc.templateVersion;
      if (!Array.isArray(doc.nodeSets)) throw bad('nodeSets 必须是数组');
      (doc.nodeSets as unknown[]).forEach((n, i) => {
        if (!isObj(n) || (n.output !== 'provider' && n.output !== 'inline')) throw bad(`节点集 ${i + 1} 的输出方式只能是 provider 或 inline`);
        refs.nodeSet(n.ref, `节点集 ${i + 1}`);
      });
      if (doc.template !== undefined) {
        if (!isObj(doc.template) || !isStr(doc.template.id) || !store.getTemplate(doc.template.id)) throw bad('模板不存在');
        const f = doc.template.follow;
        if (f !== 'latest' && !(isObj(f) && typeof f.pinned === 'number' && store.getTemplate(doc.template.id, f.pinned))) throw bad('模板版本不存在');
      }
      if (doc.base !== undefined && (!isObj(doc.base) || doc.base.stashPatch !== undefined && !isObj(doc.base.stashPatch))) throw bad('基础设置及 stashPatch 必须是对象');
      for (const key of ['surgePatch', 'loonPatch']) if (isObj(doc.base) && doc.base[key] !== undefined) {
        if (!isObj(doc.base[key])) throw bad(key + ' 必须是对象');
        try { stringifyIniBase(doc.base[key]); } catch (error) { throw bad(error instanceof Error ? error.message : '基础设置不合法'); }
      }
      if (doc.base !== undefined && isObj(doc.base) && doc.base.presetId !== undefined && !store.get('preset', String(doc.base.presetId))) throw bad('基础设置预设不存在');
      doc.overlay = isObj(doc.overlay) ? doc.overlay : {};
      doc.chains = Array.isArray(doc.chains) ? doc.chains : [];
      doc.refPolicy = { default: 'wrap' }; // 兼容旧字段，引用方式由客户端自动决定
      const extraRules = (doc.overlay as { extraRules?: unknown }).extraRules;
      if (extraRules !== undefined) {
        if (!Array.isArray(extraRules)) throw bad('extraRules 必须是数组');
        extraRules.forEach((er: unknown, i) => {
          const m = isObj(er) && isObj(er.rule) && isObj(er.rule.matcher) ? er.rule.matcher : undefined;
          if (!m) throw bad(`私有规则 ${i + 1} 格式错误`);
          checkRawRules(m, `私有规则 ${i + 1}`);
          if (m.kind === 'ruleset') {
            const prior = store.get('profile', id)?.overlay.extraRules?.find(r => r.rule.id === (er as { rule: { id: string } }).rule.id)?.rule.matcher;
            checkRuleSetReference(m as RuleSetMatcher, store, prior?.kind === 'ruleset' ? prior : undefined);
            if (!isStr(m.id) || (!m.repository && !m.remote && !refs.ruleVisible(m.id))) throw bad(`私有规则 ${i + 1}：规则集不存在`);
          }
        });
      }
      (doc.chains as Record<string, unknown>[]).forEach((ch, i) => {
        if (!isObj(ch) || !isObj(ch.landing)) throw bad(`链规则 ${i + 1} 格式错误`);
        refs.nodeSet(ch.landing.nodeSet, `链规则 ${i + 1} 的落地`);
        if (ch.landing.filter !== undefined) checkRegex(ch.landing.filter, `链规则 ${i + 1}`);
        refs.target(ch.via, `链规则 ${i + 1} 的前置`);
      });
      if (doc.routing !== undefined) {
        validateProfileRouting(doc as unknown as import('../docs.ts').ProfileDoc, store, refs);
        checkRawRules((doc.routing as { config?: { rules?: unknown } }).config?.rules, '分流规则');
      }
      break;
    }
  }
  delete doc.updateIntervalSec;
  if (kind === 'ruleset') for (const source of (doc.sources ?? []) as {fetch?:Record<string,unknown>}[]) {
    if (source.fetch) { delete source.fetch.ttlSec;if(!Object.keys(source.fetch).length)delete source.fetch; }
  }
  return doc as unknown as DocTypes[K];
}

/** 列出引用了某个文档的其他文档，删除前检查用 */
export function findReferrers(store: Store, ownerId: string, kind: DocKind, id: string): string[] {
  const hits: string[] = [];
  const isRef = (r: unknown) => isObj(r) && r.type === kind && r.id === id;
  // 比较结构，不依赖 JSON 属性排列顺序，也不把字符串内容误识别成引用。
  const contains = (value: unknown, field: 'kind' | 'type'): boolean => {
    if (Array.isArray(value)) return value.some(v => contains(v, field));
    if (!isObj(value)) return false;
    return (value[field] === kind && value.id === id) || Object.values(value).some(v => contains(v, field));
  };
  if (kind === 'source' || kind === 'collection' || kind === 'local') {
    for (const c of store.list('collection', ownerId)) if (c.members.some((m) => isRef(m.ref))) hits.push(`组合「${c.name}」`);
    for (const p of store.list('profile', ownerId)) {
      if (p.nodeSets.some((n) => isRef(n.ref)) || contains([p.overlay, p.routing, p.chains], 'type')) hits.push(`配置订阅「${p.name}」`);
    }
    for (const l of store.list('local', ownerId)) if (contains(l.proxies, 'type')) hits.push(`本地节点组「${l.name}」`);
  }
  if (kind === 'ruleset') {
    for (const p of store.list('profile')) if (contains([p.overlay, p.routing], 'kind')) {
      hits.push(store.getWithOwner('profile', p.id)?.owner === ownerId ? `配置订阅「${p.name}」` : '其他用户的配置订阅');
    }
    // 模板由管理员维护，可能引用管理员名下的公共规则集
    for (const t of store.listLatestTemplates()) {
      if (t.rules.some((r) => r.matcher.kind === 'ruleset' && r.matcher.id === id)) hits.push(`模板「${t.name ?? t.id}」`);
    }
  }
  if (kind === 'preset') {
    for (const p of store.list('profile')) if (p.base?.presetId === id) hits.push(`配置订阅「${p.name}」`);
  }
  return [...new Set(hits)];
}
