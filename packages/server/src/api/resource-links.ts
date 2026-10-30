import { Hono } from 'hono';
import type { RenderService } from '../render.ts';
import type { Store } from '../store.ts';
import { notFound, requireUser, type ApiEnv } from './common.ts';

/** 仅生成已保存对象的地址；不拉取上游、不预生成产物，不接受调用方指定 token。 */
export function resourceLinkRoutes(store: Store, renderer: RenderService, publicUrl: string) {
  const app = new Hono<ApiEnv>();
  app.get('/resource-links/:kind/:id', requireUser, c => {
    const kinds = { sources: 'source', collections: 'collection', locals: 'local', profiles: 'profile', rulesets: 'ruleset' } as const;
    const segment = c.req.param('kind');
    if (!Object.hasOwn(kinds, segment)) throw notFound();
    const kind = kinds[segment as keyof typeof kinds], id = c.req.param('id'), user = c.get('user');
    const row = store.getWithOwner(kind, id);
    if (!row || kind !== 'ruleset' && row.owner !== user.id) throw notFound();
    if (kind === 'source' || kind === 'collection' || kind === 'local') renderer.collectNodeSets([{ type: kind, id }], user.id);
    const token = store.createToken(user.id);
    const path = kind === 'profile' ? `sub/${token.token}/${encodeURIComponent(id)}` : kind === 'ruleset' ? `rules/${token.token}/${encodeURIComponent(id)}` : `nodes/${token.token}/${kind}/${encodeURIComponent(id)}`;
    return c.json({ item: { ...token, url: `${publicUrl.replace(/\/$/, '')}/${path}` } });
  });
  return app;
}
