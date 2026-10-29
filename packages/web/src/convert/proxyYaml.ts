import { parseContent, type LocalProxy, type ParseResult } from '@sub-forge/core';
import { isNode, LineCounter, parseDocument, stringify } from 'yaml';
import type { RawResult } from '../components/DualEditor.tsx';
import { isRecord } from '../components/schema.ts';
import { schemaFor } from '../schemas/proxy.ts';
import { recoverFields, recoverYaml } from './recoverYaml.ts';

/** 本地节点只录入节点信息；代理链统一在配置订阅的链规则中设置，YAML 中出现这些字段直接报错 */
const CHAIN_KEYS = ['dialer', 'dialer-proxy', 'underlying-proxy'];
const CHAIN_HINT = '本地节点不处理代理链，请在配置订阅的「代理链」中设置';

export const proxyToYaml = (proxy: LocalProxy): string => stringify(proxy);
export const groupToYaml = (proxies: LocalProxy[]): string => stringify({ proxies });

/** 粘贴时实时解析；损坏的 YAML 显示诊断，不中断页面渲染。 */
export function parseProxyImport(text: string): ParseResult {
  try {
    return parseContent(text, { type: 'local', id: 'paste' });
  } catch (error) {
    return { format: 'clash', proxies: [], failures: [{ line: 'Clash YAML', reason: error instanceof Error ? error.message : String(error) }] };
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
    const doc = parseDocument(text, { lineCounter: lines });
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
