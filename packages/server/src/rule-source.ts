// 来源读取只负责原文及来源诊断，不依赖客户端、改写或展示范围。
import type { RuleSetDoc, RuleSetSourceDoc } from './docs.ts';
import type { SnapshotService } from './snapshots.ts';
import { RuleConverter } from './rule-converter.ts';

export class RuleSourceService {
  private readonly drafts = new Map<string, Promise<{ body?: string; error?: string }>>();
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private async limited<T>(read: () => Promise<T>): Promise<T> {
    if (this.active >= 4) await new Promise<void>(resolve => this.waiting.push(resolve));
    else this.active++;
    try { return await read(); }
    finally { const next = this.waiting.shift(); if (next) next(); else this.active--; }
  }
  constructor(private readonly snapshots: SnapshotService, private readonly converter: RuleConverter) {}
  async get(userId: string, source: RuleSetSourceDoc, saved?: RuleSetDoc, refresh = false) {
    let content = source.kind === 'local' ? source.content ?? '' : undefined;
    let error: string | undefined;
    let fetchedAt: number | undefined;
    let stale = false;
    const passthrough = ['mrs', 'srs'].includes(source.format);
    if (source.kind === 'remote') {
      const prior = saved?.sources.find(s => s.kind === 'remote' && s.url === source.url && JSON.stringify({ua:s.fetch?.ua,timeoutMs:s.fetch?.timeoutMs}) === JSON.stringify({ua:source.fetch?.ua,timeoutMs:source.fetch?.timeoutMs}));
      if (saved && prior) {
        const result = await this.limited(() => this.snapshots.get('ruleset', saved.id, source.url!, { ...source.fetch, format: source.format, scope: source.repository && !source.fetch?.ua ? 'public-repository' : userId }, { waitForFresh: true, refresh }));
        content = result.snapshot?.body; fetchedAt = result.snapshot?.fetchedAt; error = result.error; stale = result.stale;
      } else {
        const key = JSON.stringify([userId, source.url, source.format, source.fetch ?? {}]);

        let pending = this.drafts.get(key);
        if (!pending) {
          pending = this.limited(() => this.snapshots.peekRuleContent(source.url!, source.fetch))
            .finally(() => this.drafts.delete(key));
          this.drafts.set(key, pending);
        }
        // 仅合并仍在执行的请求；完成后立即移除，不保存草稿时间缓存。
        const result = await pending;
        content = result.body; error = result.error;
      }
    }
    const parsed = content !== undefined || passthrough ? this.converter.prepare(passthrough ? '' : content ?? '', source) : undefined;
    return {
      content,
      status: { id: source.id, ok: !error && (content !== undefined || passthrough), error, fetchedAt, stale, ...(passthrough ? { passthrough: true } : {}),
        conversion: parsed?.format === 'yaml' ? 'yaml-to-list' : undefined,
        format: parsed?.format, behavior: parsed?.behavior, rules: parsed?.parsed,
        rejected: parsed?.diagnostics.length, rejectedDetails: parsed?.diagnostics.length ? parsed.diagnostics.slice(0, 100).map(({ line, text, reason }) => ({ line, text, reason })) : undefined },
    };
  }
}
