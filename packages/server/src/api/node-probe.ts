import { Hono } from 'hono';
import { validateLocalProxy, type LocalProxy } from '@sub-forge/core';
import type { NodeProbe } from '../node-probe.ts';
import { bad, HttpError, jsonBody, requireUser, type ApiEnv } from './common.ts';

export function nodeProbeRoutes(probe?: NodeProbe) {
  const api = new Hono<ApiEnv>();
  const jobs = new Map<string, { owner: string; abort: AbortController }>();
  api.use('/node-probe/*', requireUser);
  api.use('/node-probe', requireUser);
  api.get('/node-probe', async c => c.json({ available: !!probe && await probe.available() }));
  api.post('/node-probe', async c => {
    const { node, requestId } = await jsonBody(c);
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(requestId)) throw bad('测试标识无效');
    if (JSON.stringify(node)?.length > 65536) throw bad('节点配置过大');
    const issues = validateLocalProxy(node);
    if (issues.length) throw bad(issues[0]!.message);
    if (!probe) return c.json({ ok: false, status: 'unavailable', message: '测试服务未配置', testedAt: Date.now(), target: '' });
    const owner = c.get('user').id;
    if (jobs.has(requestId) || [...jobs.values()].some(job => job.owner === owner) || jobs.size >= 2) throw new HttpError(429, '测试正在进行，请稍后重试');
    const abort = new AbortController();
    const cancel = () => abort.abort();
    c.req.raw.signal.addEventListener('abort', cancel, { once: true });
    if (c.req.raw.signal.aborted) abort.abort();
    jobs.set(requestId, { owner, abort });
    c.header('cache-control', 'no-store');
    try { return c.json(await probe.run(node as LocalProxy, abort.signal)); }
    finally { jobs.delete(requestId); c.req.raw.signal.removeEventListener('abort', cancel); }
  });
  api.delete('/node-probe/:id', c => {
    const job = jobs.get(c.req.param('id'));
    if (job?.owner === c.get('user').id) job.abort.abort();
    return c.json({ ok: true });
  });
  return api;
}
