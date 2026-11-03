// 来源读取只负责原文及来源诊断，不依赖客户端、改写或展示范围。
import type { RuleSetDoc, RuleSetSourceDoc } from './docs.ts';
import type { SnapshotService } from './snapshots.ts';
import { RuleConverter } from './rule-converter.ts';

export class RuleSourceService {
  private readonly drafts = new Map<string, Promise<{ body?: string; error?: string }>>();
  constructor(private readonly snapshots: SnapshotService, private readonly converter: RuleConverter) {}
  async get(userId: string, source: RuleSetSourceDoc, saved?: RuleSetDoc, refresh = false) {
    let content = source.kind === 'local' ? source.content ?? '' : undefined;
    let error: string | undefined;
    let fetchedAt: number | undefined;
    const binary = ['mrs', 'srs'].includes(source.format);
    if (source.kind === 'remote') {
      const prior = saved?.sources.find(s => s.kind === 'remote' && s.url === source.url && s.format === source.format && s.behavior === source.behavior && JSON.stringify({ua:s.fetch?.ua,timeoutMs:s.fetch?.timeoutMs}) === JSON.stringify({ua:source.fetch?.ua,timeoutMs:source.fetch?.timeoutMs}));
      if (saved && prior) {
        const params = { ...source.fetch, format: source.format, behavior: source.behavior };
        try {
          const result = await (refresh ? this.snapshots.refreshRuleContent(source.url!, params) : this.snapshots.getRuleContent(source.url!, params));
          content = result.body; fetchedAt = result.fetchedAt;
        } catch (reason) { error = (reason as Error).message; }
      } else {
        const key = JSON.stringify([userId, source.url, source.format, source.fetch ?? {}]);

        let pending = this.drafts.get(key);
        if (!pending) {
          pending = this.snapshots.peekRuleContent(source.url!, source.fetch).finally(() => this.drafts.delete(key));
          this.drafts.set(key, pending);
        }
        // 仅合并仍在执行的请求；完成后立即移除，不保存草稿时间缓存。
        const result = await pending;
        content = result.body; error = result.error;
      }
    }
    const parsed = content !== undefined || binary ? this.converter.prepare(binary ? '' : content ?? '', source) : undefined;
    return {
      content,
      status: { id: source.id, ok: !error && (content !== undefined || binary), error, fetchedAt, ...(binary ? { binary: true } : {}),
        conversion: parsed?.format === 'yaml' ? 'yaml-to-list' : undefined,
        format: parsed?.format, behavior: parsed?.behavior, rules: parsed?.parsed,
        rejected: parsed?.diagnostics.length, rejectedDetails: parsed?.diagnostics.length ? parsed.diagnostics.slice(0, 100).map(({ line, text, reason }) => ({ line, text, reason })) : undefined },
    };
  }
}
