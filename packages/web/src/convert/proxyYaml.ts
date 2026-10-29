import { parseContent, type LocalProxy, type ParseResult } from '@sub-forge/core';
import { isNode, LineCounter, parseDocument, stringify } from 'yaml';
import type { RawResult } from '../components/DualEditor.tsx';
import { isRecord } from '../components/schema.ts';
import { schemaFor } from '../schemas/proxy.ts';
import { recoverFields, recoverYaml } from './recoverYaml.ts';

const withoutDialer = ({ dialer: _dialer, ...proxy }: LocalProxy) => proxy;
export const proxyToYaml = (proxy: LocalProxy): string => stringify(withoutDialer(proxy));
export const groupToYaml = (proxies: LocalProxy[]): string => stringify({ proxies: proxies.map(withoutDialer) });

/** 粘贴时实时解析；损坏的 YAML 显示诊断，不中断页面渲染。 */
export function parseProxyImport(text: string): ParseResult {
  try {
    return parseContent(text, { type: 'local', id: 'paste' });
  } catch (error) {
    return { format: 'clash', proxies: [], failures: [{ line: 'Clash YAML', reason: error instanceof Error ? error.message : String(error) }] };
  }
}

export function proxyFormFromYaml(text: string, current?: LocalProxy) {
  const recovered = recoverYaml(text);
  const notes = recovered.notes;
  const value = { ...recovered.value };
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
  return { value: validate(fields, current, true), notes };
}

function validate(value: unknown, current?: LocalProxy, draft = false): LocalProxy {
  if (!isRecord(value)) throw new Error('节点必须是 YAML 映射');
  // 编辑草稿允许未填写必填项；补为表单可表示的空值，不恢复已被用户删除的旧值。
  const fields = draft ? { ...value, name: value.name ?? '', type: value.type ?? '', server: value.server ?? '', port: value.port ?? 0 } : value;
  for (const key of ['name', 'type', 'server']) {
    if (typeof fields[key] !== 'string' || (!draft && !fields[key].trim())) throw new Error(`缺少或无效的 ${key}（需要${draft ? '' : '非空'}字符串）`);
  }
  if (typeof fields.port !== 'number' || !Number.isFinite(fields.port)) throw new Error('缺少或无效的 port（需要数字）');
  const { dialer: _dialer, ...rest } = fields;
  return { ...rest, ...(current?.dialer ? { dialer: current.dialer } : {}) } as LocalProxy;
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

/** 当前节点独立于名称匹配，允许在 YAML 中改名而保留前置。 */
export function proxyFromYaml(text: string, current?: LocalProxy): RawResult<LocalProxy> {
  return read(text, false, (value, line) => {
    try { return validate(value, current); }
    catch (error) { throw new ProxyYamlError(error instanceof Error ? error.message : String(error), line(0)); }
  });
}

/** 单节点编辑只要求结构能被表单表示，必填项在保存时由服务端校验。批量导入仍使用严格校验。 */
export function proxyDraftFromYaml(text: string, current?: LocalProxy): RawResult<LocalProxy> {
  return read(text, false, (value, line) => {
    try { return validate(value, current, true); }
    catch (error) { throw new ProxyYamlError(error instanceof Error ? error.message : String(error), line(0)); }
  });
}

export function groupFromYaml(text: string, current: LocalProxy[]): RawResult<LocalProxy[]> {
  return read(text, true, (value, line) => {
    if (!isRecord(value) || !Array.isArray(value.proxies)) throw new Error('需要包含 proxies 列表的 YAML 映射');
    return value.proxies.map((item: unknown, index: number) => {
      try {
        return validate(item, isRecord(item) ? current.find((p) => p.name === item.name) : undefined);
      } catch (error) {
        throw new ProxyYamlError(`第 ${index + 1} 个节点：${error instanceof Error ? error.message : String(error)}`, line(index));
      }
    });
  });
}
