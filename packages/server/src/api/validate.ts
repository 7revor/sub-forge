// 保存前的校验：结构必填项、正则能否编译、引用是否存在且属于当前用户、组合是否成环。
// 深层结构（规则、组参数等）由渲染报告兜住，这里只拦截保存后必然无法使用的数据。

import { compileUserRegex, findCollectionCycles, type Collection, type NodeSetID, type OperatorStep, type Target } from '@sub-forge/core';
import type { DocKind, DocTypes } from '../docs.ts';
import type { Store, User } from '../store.ts';
import { bad, isStr } from './common.ts';

const OPS = new Set(['filter.regex', 'filter.type', 'filter.useless', 'rename.regex', 'rename.delete', 'rename.affix', 'flag', 'sort.name', 'sort.regex', 'dedupe', 'set', 'script']);
const RULESET_FORMATS = new Set(['auto', 'classical', 'domain', 'ipcidr', 'domain-set', 'yaml', 'mrs', 'srs']);
const NODESET_KINDS = new Set(['source', 'collection', 'local']);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isHttpUrl = (v: unknown) => { if (typeof v !== 'string') return false; try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; } };

function checkRegex(pattern: unknown, where: string): void {
  if (typeof pattern !== 'string') throw bad(`${where}：正则必须是字符串`);
  try { compileUserRegex(pattern); } catch (e) { throw bad(`${where}：${(e as Error).message}`); }
}

function checkPipeline(steps: unknown, where: string, user: User): void {
  if (!Array.isArray(steps)) throw bad(`${where}：pipeline 必须是数组`);
  steps.forEach((s: unknown, i) => {
    const at = `${where} 第 ${i + 1} 步`;
    if (!isObj(s) || typeof s.op !== 'string' || !OPS.has(s.op)) throw bad(`${at}：未知的处理器`);
    const step = s as OperatorStep;
    if (step.op === 'script' && !(user.role === 'admin' || user.scriptAllowed)) throw bad(`${at}：没有编写脚本的权限（SRC-08）`);
    if (step.op === 'filter.regex' || step.op === 'sort.regex' || step.op === 'rename.delete') step.patterns.forEach((p) => checkRegex(p, at));
    if (step.op === 'filter.useless') step.patterns?.forEach((p) => checkRegex(p, at));
    if (step.op === 'rename.regex') step.rules.forEach((r) => checkRegex(r.pattern, at));
  });
}

export class RefChecker {
  constructor(private readonly store: Store, private readonly user: User) {}

  owned(kind: DocKind, id: string): boolean {
    const row = this.store.getWithOwner(kind, id);
    return !!row && row.owner === this.user.id;
  }

  /** 规则集 / 规则包：自己的，或管理员名下的公共规则（模板由管理员维护，会引用这些） */
  ruleVisible(kind: 'ruleset' | 'bundle', id: string): boolean {
    const row = this.store.getWithOwner(kind, id);
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

/** 校验并返回规范化后的文档（id 由调用方确定） */
export function validateDoc<K extends DocKind>(kind: K, body: Record<string, unknown>, id: string, user: User, store: Store): DocTypes[K] {
  if (!isStr(body.name)) throw bad('name 不能为空');
  const doc = { ...body, id } as Record<string, unknown>;
  const refs = new RefChecker(store, user);

  switch (kind) {
    case 'source': {
      if (doc.kind === 'remote') {
        if (!Array.isArray(doc.urls) || !doc.urls.length || !doc.urls.every(isHttpUrl)) throw bad('远程订阅源需要至少一个 http(s) 地址');
      } else if (doc.kind === 'local') {
        if (typeof doc.content !== 'string') throw bad('本地订阅源需要 content');
      } else throw bad('kind 只能是 remote 或 local');
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
        if (p.dialer !== undefined) refs.target(p.dialer as Target, `节点「${p.name}」的前置`);
      });
      break;
    }
    case 'ruleset': {
      if (!RULESET_FORMATS.has(doc.format as string)) throw bad('format 不合法');
      if (doc.kind === 'remote') { if (!isHttpUrl(doc.url)) throw bad('远程规则集需要 http(s) 地址'); }
      else if (doc.kind === 'local') { if (typeof doc.content !== 'string') throw bad('本地规则集需要 content'); }
      else throw bad('kind 只能是 remote 或 local');
      if ((doc.format === 'mrs') && doc.behavior !== 'domain' && doc.behavior !== 'ipcidr') throw bad('mrs 规则集需要声明 behavior 为 domain 或 ipcidr');
      break;
    }
    case 'bundle': {
      if (!Array.isArray(doc.items)) throw bad('items 必须是数组');
      (doc.items as unknown[]).forEach((it, i) => {
        if (!isObj(it)) throw bad(`子项 ${i + 1} 格式错误`);
        if (it.kind === 'bundle') throw bad('规则包不能包含规则包（最多两层）');
        if (it.kind === 'ruleset') { if (!isStr(it.id) || !refs.ruleVisible('ruleset', it.id)) throw bad(`子项 ${i + 1}：规则集不存在`); }
        else if (it.kind !== 'rule' || !isObj(it.rule)) throw bad(`子项 ${i + 1} 格式错误`);
      });
      break;
    }
    case 'preset': {
      if (!isObj(doc.mihomo)) throw bad('mihomo 段必须是对象');
      if (doc.surge !== undefined) {
        if (!isObj(doc.surge)) throw bad('surge 段必须是对象');
        if (doc.surge.general !== undefined && !isObj(doc.surge.general)) throw bad('surge.general 必须是对象');
        if (doc.surge.host !== undefined && (!isObj(doc.surge.host) || !Object.values(doc.surge.host).every((v) => typeof v === 'string'))) throw bad('surge.host 必须是值为字符串的对象');
      }
      if (typeof doc.version !== 'number') doc.version = 1;
      break;
    }
    case 'profile': {
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
      if (doc.base !== undefined && isObj(doc.base) && doc.base.presetId !== undefined && !store.get('preset', String(doc.base.presetId))) throw bad('基础设置预设不存在');
      doc.overlay = isObj(doc.overlay) ? doc.overlay : {};
      doc.chains = Array.isArray(doc.chains) ? doc.chains : [];
      doc.refPolicy = isObj(doc.refPolicy) ? doc.refPolicy : { default: 'wrap' };
      const extraRules = (doc.overlay as { extraRules?: unknown }).extraRules;
      if (extraRules !== undefined) {
        if (!Array.isArray(extraRules)) throw bad('extraRules 必须是数组');
        extraRules.forEach((er: unknown, i) => {
          const m = isObj(er) && isObj(er.rule) && isObj(er.rule.matcher) ? er.rule.matcher : undefined;
          if (!m) throw bad(`私有规则 ${i + 1} 格式错误`);
          if ((m.kind === 'ruleset' || m.kind === 'bundle') && !(isStr(m.id) && refs.ruleVisible(m.kind, m.id))) throw bad(`私有规则 ${i + 1}：${m.kind === 'ruleset' ? '规则集' : '规则包'}不存在`);
        });
      }
      (doc.chains as Record<string, unknown>[]).forEach((ch, i) => {
        if (!isObj(ch) || !isObj(ch.landing)) throw bad(`链规则 ${i + 1} 格式错误`);
        refs.nodeSet(ch.landing.nodeSet, `链规则 ${i + 1} 的落地`);
        if (ch.landing.filter !== undefined) checkRegex(ch.landing.filter, `链规则 ${i + 1}`);
        refs.target(ch.via, `链规则 ${i + 1} 的前置`);
      });
      break;
    }
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
      if (p.nodeSets.some((n) => isRef(n.ref)) || contains([p.overlay, p.chains], 'type')) hits.push(`配置订阅「${p.name}」`);
    }
    for (const l of store.list('local', ownerId)) if (contains(l.proxies, 'type')) hits.push(`本地节点组「${l.name}」`);
  }
  if (kind === 'ruleset') {
    for (const b of store.list('bundle')) if (b.items.some((i) => i.kind === 'ruleset' && i.id === id)) {
      hits.push(store.getWithOwner('bundle', b.id)?.owner === ownerId ? `规则包「${b.name}」` : '其他用户的规则包');
    }
  }
  if (kind === 'ruleset' || kind === 'bundle') {
    for (const p of store.list('profile')) if (contains(p.overlay, 'kind')) {
      hits.push(store.getWithOwner('profile', p.id)?.owner === ownerId ? `配置订阅「${p.name}」` : '其他用户的配置订阅');
    }
  }
  if (kind === 'ruleset' || kind === 'bundle') {
    // 模板由管理员维护，可能引用管理员名下的公共规则集 / 规则包
    for (const t of store.listAllTemplateVersions()) {
      const used = t.rules.some((r) => r.matcher.kind === kind && r.matcher.id === id)
        || (kind === 'ruleset' && t.rules.some((r) => r.matcher.kind === 'bundle' && store.get('bundle', r.matcher.id)?.items.some((i) => i.kind === 'ruleset' && i.id === id)));
      if (used) hits.push(`模板「${t.name ?? t.id}」v${t.version}`);
    }
  }
  if (kind === 'preset') {
    for (const p of store.list('profile')) if (p.base?.presetId === id) hits.push(`配置订阅「${p.name}」`);
  }
  return [...new Set(hits)];
}
