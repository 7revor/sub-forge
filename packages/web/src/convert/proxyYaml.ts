import { parseClientProxyObject, parseContent, tryDecodeBase64, type LocalProxy } from '@sub-forge/core';
import { isNode, LineCounter, parseDocument, stringify } from 'yaml';
import type { RawResult } from '../components/DualEditor.tsx';
import { isRecord } from '../components/schema.ts';
import { schemaFor } from '../schemas/proxy.ts';
import { recoverFields, recoverYaml } from './recoverYaml.ts';
import { parseYamlDocument } from './yamlDocument.ts';

/** 本地节点只录入节点信息；代理链统一在配置订阅的链规则中设置，YAML 中出现这些字段直接报错 */
const CHAIN_KEYS = ['dialer', 'dialer-proxy', 'underlying-proxy'];
const CHAIN_HINT = '本地节点不处理代理链，请在配置订阅的「代理链」中设置';

export const proxyToYaml = (proxy: LocalProxy): string => stringify(proxy);
export const groupToYaml = (proxies: LocalProxy[]): string => stringify({ proxies });

/** 完整节点替换当前草稿；字段片段返回 undefined，按普通文本插入。任何失败都不导入部分结果。 */
export function proxyFromPaste(text: string): RawResult<LocalProxy> | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    const linkLike = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
    const surgeLike = /^\s*\[Proxy\]\s*$/m.test(trimmed) || /^[^=\n]+=\s*[a-z0-9-]+\s*,/i.test(trimmed);
    const doc = parseDocument(text);
    const structured = linkLike || surgeLike ? undefined : doc.toJS({ maxAliasCount: 100 }) as unknown;
    const isNodeObject = (value: unknown) => isRecord(value) && (
      'protocol' in value ||
      ('type' in value && ['name', 'server', 'port', 'server_port'].some((key) => key in value)) ||
      ('add' in value && 'id' in value)
    );
    const nodeLike = isNodeObject(structured) || (isRecord(structured) && ('proxies' in structured || 'outbounds' in structured));
    const listLike = Array.isArray(structured) && structured.some(isNodeObject);
    const encoded = tryDecodeBase64(trimmed);
    if (!linkLike && !surgeLike && doc.errors.length && /^\s*(?:-\s+)?(?:name|type|server|port|proxies|outbounds|protocol)\s*:/m.test(text)) throw doc.errors[0];
    if (!nodeLike && !listLike && !linkLike && !surgeLike && !encoded?.includes('://')) return undefined;
    if ((nodeLike || listLike) && doc.errors.length) throw doc.errors[0];
    if (/^https?:\/\//i.test(trimmed) && !trimmed.includes('\n')) {
      const url = new URL(trimmed);
      const explicitPort = /^https?:\/\/(?:[^@\s]+@)?(?:\[[^\]]+\]|[^:/\s]+):\d+(?:[/#?]|$)/i.test(trimmed);
      if (!explicitPort || (url.pathname && url.pathname !== '/') || url.search) throw new Error('网页或订阅地址请添加到「订阅源」；这里接收节点分享链接或节点配置');
    }

    let input = text;
    if (nodeLike || listLike) {
      const items = Array.isArray(structured) ? structured : isRecord(structured) && 'proxies' in structured ? structured.proxies : isRecord(structured) && 'outbounds' in structured ? structured.outbounds : [structured];
      if (!Array.isArray(items)) throw new Error('proxies / outbounds 必须是节点列表');
      if (items.length > 1) throw new Error(`识别到 ${items.length} 个节点，只允许单节点，请拆分后逐个添加，或前往分组批量导入`);
      if (items.length === 0) throw new Error('配置中没有节点');
      input = stringify(parseClientProxyObject(items[0]) ?? items[0]);
    }
    const parsed = parseContent(input, { type: 'local', id: 'paste' });
    if (parsed.proxies.length + parsed.failures.length > 1) throw new Error('包含多个节点或多行无效内容，只允许单节点，请拆分后逐个添加，或前往分组批量导入');
    if (parsed.failures.length) throw new Error(parsed.failures.map((f) => f.reason).join('；'));
    if (parsed.proxies.length !== 1) throw new Error('未识别到节点，请粘贴受支持的单节点配置');
    const { _source, _origName, _key, upstreamDialer, ...fields } = parsed.proxies[0]!;
    const notes = ['已转换为 Mihomo YAML，保存后生效。'];
    for (const key of CHAIN_KEYS) {
      if (!(key in fields)) continue;
      delete fields[key];
      notes.push(`已忽略 ${key}：${CHAIN_HINT}`);
    }
    if (upstreamDialer) notes.push(`已忽略节点自带前置：${CHAIN_HINT}`);
    if (!Number.isInteger(fields.port) || fields.port < 1 || fields.port > 65535) throw new Error('端口必须是 1–65535 的整数');
    return { ok: true, value: validate(fields), notes };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function proxyFormFromYaml(text: string) {
  const recovered = recoverYaml(text);
  const notes = recovered.notes;
  const value = { ...recovered.value };
  for (const key of CHAIN_KEYS) {
    if (!(key in value)) continue;
    notes.push(`已忽略 ${key}：${CHAIN_HINT}`);
    delete value[key];
  }
  for (const key of ['name', 'type', 'server']) {
    if (typeof value[key] === 'string') continue;
    if (value[key] != null) notes.push(`已忽略 ${key}：需要字符串`);
    value[key] = '';
  }
  if (typeof value.port !== 'number' || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535) {
    if (value.port != null && value.port !== 0) notes.push('已忽略 port：需要 1–65535 的整数');
    value.port = 0;
  }
  const fields = recoverFields(value, schemaFor(value.type as string), notes);
  return { value: validate(fields, true), notes };
}

function validate(value: unknown, draft = false): LocalProxy {
  if (!isRecord(value)) throw new Error('节点必须是 YAML 映射');
  // 编辑草稿允许未填写必填项；补为表单可表示的空值，不恢复已被用户删除的旧值。
  const fields = draft ? { ...value, name: value.name ?? '', type: value.type ?? '', server: value.server ?? '', port: value.port ?? 0 } : value;
  for (const key of ['name', 'type', 'server']) {
    if (typeof fields[key] !== 'string' || (!draft && !fields[key].trim())) throw new Error(`缺少或无效的 ${key}（需要${draft ? '' : '非空'}字符串）`);
  }
  if (typeof fields.port !== 'number' || !Number.isFinite(fields.port)) throw new Error('缺少或无效的 port（需要数字）');
  for (const key of CHAIN_KEYS) if (key in fields) throw new Error(`不能设置 ${key}：${CHAIN_HINT}`);
  return fields as LocalProxy;
}

class ProxyYamlError extends Error {
  constructor(message: string, readonly line: number) { super(message); }
}

function read<T>(text: string, group: boolean, convert: (value: unknown, line: (index: number) => number) => T): RawResult<T> {
  const lines = new LineCounter();
  try {
    const doc = parseYamlDocument(text, { lineCounter: lines }, group ? 'proxies' : 'mapping');
    const error = doc.errors[0] ?? doc.warnings[0];
    if (error) return { ok: false, error: error.message, line: lines.linePos(error.pos[0]).line };
    const line = (index: number) => {
      const node = group ? doc.getIn(['proxies', index], true) : doc.contents;
      return isNode(node) && node.range ? lines.linePos(node.range[0]).line : 1;
    };
    return { ok: true, value: convert(doc.toJS({ maxAliasCount: 100 }), line) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), line: error instanceof ProxyYamlError ? error.line : 1 };
  }
}

export function proxyFromYaml(text: string): RawResult<LocalProxy> {
  return read(text, false, (value, line) => {
    try { return validate(value); }
    catch (error) { throw new ProxyYamlError(error instanceof Error ? error.message : String(error), line(0)); }
  });
}

/** 单节点编辑只要求结构能被表单表示，必填项在保存时由服务端校验。批量导入仍使用严格校验。 */
export function proxyDraftFromYaml(text: string): RawResult<LocalProxy> {
  return read(text, false, (value, line) => {
    try { return validate(value, true); }
    catch (error) { throw new ProxyYamlError(error instanceof Error ? error.message : String(error), line(0)); }
  });
}

export function groupFromYaml(text: string): RawResult<LocalProxy[]> {
  return read(text, true, (value, line) => {
    if (!isRecord(value) || !Array.isArray(value.proxies)) throw new Error('需要包含 proxies 列表的 YAML 映射');
    return value.proxies.map((item: unknown, index: number) => {
      try {
        return validate(item);
      } catch (error) {
        throw new ProxyYamlError(`第 ${index + 1} 个节点：${error instanceof Error ? error.message : String(error)}`, line(index));
      }
    });
  });
}
