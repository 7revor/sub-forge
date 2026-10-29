import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addUser, client, serve, setupApp } from './helpers.ts';

const url = 'https://sub.example.test/pipeline';
const h = setupApp({ fetcher: serve({ [url]: 'trojan://test@node.example.test:443#节点' }) });
const admin = client(h.app);
const source = { name: '原始订阅', urls: [url], pipeline: [] };
let id: string;
let collectionId: string;
beforeAll(async () => {
  await addUser(h.store, 'admin', 'admin'); await admin.login('admin');
  id = (await admin.post('/api/sources', source)).json.item.id;
  collectionId = (await admin.post('/api/collections', { name: '组合', members: [{ ref: { type: 'source', id } }], pipeline: [] })).json.item.id;
});
afterAll(async () => { await h.snapshots.settled(); h.store.close(); });

describe('处理链参数的保存和预览校验', () => {
  it.each([
    null, [], { op: 'unknown' },
    { op: 'filter.regex' }, { op: 'filter.regex', patterns: null }, { op: 'filter.regex', patterns: 'HK' },
    { op: 'filter.regex', patterns: [1], keep: true }, { op: 'filter.regex', patterns: ['HK'], keep: 'yes' },
    { op: 'filter.regex', patterns: ['(['], keep: true },
    { op: 'filter.type', types: null, keep: true }, { op: 'filter.type', types: [1], keep: true },
    { op: 'filter.type', types: ['ss'] },
    { op: 'filter.useless', patterns: 1 }, { op: 'sort.regex' }, { op: 'rename.delete', patterns: {} },
    { op: 'rename.regex' }, { op: 'rename.regex', rules: 'invalid' }, { op: 'rename.regex', rules: [null] },
    { op: 'rename.regex', rules: [{ pattern: 'HK' }] },
    { op: 'rename.regex', rules: [{ pattern: 123, replace: '' }] },
    { op: 'rename.regex', rules: [{ pattern: 'HK', replace: '', flags: 1 }] },
    { op: 'rename.regex', rules: [{ pattern: 'HK', replace: '', flags: 'z' }] },
    { op: 'rename.regex', rules: [{ pattern: 'HK', replace: '', flags: 'ii' }] },
    { op: 'rename.affix', prefix: {} }, { op: 'rename.affix', suffix: null },
    { op: 'flag', mode: 'invalid' }, { op: 'sort.name' },
    { op: 'dedupe', strategy: 'invalid' }, { op: 'dedupe', strategy: 'suffix', by: 'invalid' },
    { op: 'set' }, { op: 'set', fields: [] }, { op: 'set', fields: { name: '改身份' } },
    { op: 'set', fields: { _key: '改标识' } }, { op: 'script', code: null },
    { op: 'filter.useless', enabled: 'false' },
    { op: 'filter.regex', enabled: false },
  ])('非法处理器 %j 返回 400，不写入或污染已有处理链', async step => {
    const draft = { ...source, pipeline: [step] };
    for (const result of [
      await admin.post('/api/sources', draft),
      await admin.put(`/api/sources/${id}`, draft),
      await admin.post(`/api/sources/${id}/pipeline-preview`, { pipeline: [step] }),
      await admin.post(`/api/collections/${collectionId}/pipeline-preview`, { pipeline: [step] }),
    ]) {
      expect(result.status).toBe(400);
      expect(result.json.error).toContain('第 1 步');
    }
    expect(h.store.list('source')).toHaveLength(1);
    expect(h.store.get('source', id)?.pipeline).toEqual([]);
  });

  it('有效的空数组、占位正则与各处理器参数仍可保存和预览', async () => {
    const pipeline = [
      { op: 'filter.regex', patterns: [''], keep: true }, { op: 'filter.type', types: [], keep: false },
      { op: 'filter.useless' }, { op: 'sort.regex', patterns: [] }, { op: 'rename.delete', patterns: [] },
      { op: 'rename.regex', rules: [{ pattern: '(?i)^节点$', flags: 'g', replace: '改名节点' }] },
      { op: 'rename.affix', prefix: '' }, { op: 'flag', mode: 'remove' }, { op: 'sort.name', order: 'asc' },
      { op: 'dedupe', strategy: 'suffix' }, { op: 'set', fields: { udp: true, extra: { nested: true } } },
      { op: 'script', code: '(nodes) => nodes', enabled: false },
    ];
    const created = await admin.post('/api/sources', { ...source, pipeline });
    expect(created.status).toBe(201);
    const res = await admin.post(`/api/sources/${created.json.item.id}/pipeline-preview`, {});
    expect(res.status).toBe(200);
    expect(res.json.nodes.map((n: { name: string }) => n.name)).toEqual(['改名节点']);
    expect(res.json.trace.every((step: { error?: string }) => !step.error)).toBe(true);
  });
});
