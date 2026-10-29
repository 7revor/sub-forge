// 服务端转换器：不访问上游，按内容缓存解析结果，供规则预览与其他管理模块复用。
import { createHash } from 'node:crypto';
import { convertRuleDocuments, prepareRuleDocument, ruleSetDelivery, sourceKey, type ClientCtx, type RuleConversion, type RuleDocument, type RuleSet, type RuleSetDelivery, type RuleSetSource } from '@sub-forge/core';

export type ConversionInput = { source: RuleSetSource; content?: string };
export type ConversionResult = RuleConversion & { delivery: RuleSetDelivery; passthrough: boolean };
export class RuleConverter {
  private readonly parsed = new Map<string, { document: RuleDocument; bytes: number }>();
  private bytes = 0;
  prepare(content: string, source: RuleSetSource): RuleDocument {
    const key = createHash('sha256').update(JSON.stringify([source.id, source.format, source.repository?.path, source.url, content])).digest('hex');
    const hit = this.parsed.get(key);
    if (hit) { this.parsed.delete(key); this.parsed.set(key, hit); return hit.document; }
    const document = prepareRuleDocument(content, source);
    const bytes = Buffer.byteLength(JSON.stringify(document));
    if (bytes <= 16 * 1024 * 1024) {
      this.parsed.set(key, { document, bytes }); this.bytes += bytes;
      while (this.bytes > 16 * 1024 * 1024 || this.parsed.size > 64) {
        const oldest = this.parsed.keys().next().value!;
        this.bytes -= this.parsed.get(oldest)!.bytes; this.parsed.delete(oldest);
      }
    }
    return document;
  }
  convert(inputs: ConversionInput[], options: Pick<RuleSet, 'overrides' | 'noResolve'>, ctx: ClientCtx, sourceId?: string): ConversionResult {
    const rs: RuleSet = { id: 'conversion', name: '', sources: inputs.map(i => i.source), ...options };
    const documents = new Map(inputs.filter(i => i.content !== undefined || ['mrs', 'srs'].includes(i.source.format)).map(i => [i.source.id, this.prepare(i.content ?? '', i.source)]));
    const snapshots = Object.fromEntries(inputs.filter(i => i.content !== undefined).map(i => [sourceKey(rs.id, i.source.id), i.content!]));
    const scope = sourceId ? { ...rs, sources: rs.sources.filter(s => s.id === sourceId).map(s => ({ ...s, enabled: true })) } : rs;
    // 无法解析的输入仍以注释呈现；不能让输出方式判定阻断其他有效来源。
    const invalid = scope.sources.filter(s => s.enabled !== false).some(s => documents.get(s.id)?.diagnostics.some(x => x.kind === 'invalid'));
    const delivery = invalid ? { mode: 'managed' as const, format: 'text' as const, behavior: 'classical' as const } : ruleSetDelivery(scope, { rulesets: { [rs.id]: scope }, snapshots }, ctx, undefined, documents);
    return { ...convertRuleDocuments(rs, documents, ctx, { sourceId }), delivery,
      passthrough: scope.sources.length > 0 && scope.sources.every(s => ['mrs', 'srs'].includes(s.format)) };
  }
}
