import { describe, expect, it } from 'vitest';
import { Store } from '../src/store.ts';

const T = (version: number) => ({ id: 'std', version, groups: [], rules: [], final: { kind: 'builtin' as const, name: 'DIRECT' as const } });

describe('Store', () => {
  it('文档读写与覆盖', () => {
    const s = new Store(':memory:');
    s.put('source', { id: 'a', name: 'A', kind: 'local', content: 'x', pipeline: [] });
    s.put('source', { id: 'a', name: 'A2', kind: 'local', content: 'x', pipeline: [] });
    expect(s.get('source', 'a')!.name).toBe('A2');
    expect(s.get('source', 'missing')).toBeUndefined();
    expect(s.list('source')).toHaveLength(1);
  });

  it('模板按版本保存，缺省取最新', () => {
    const s = new Store(':memory:');
    s.importSeed({ templates: [T(1), T(3), T(2)] });
    expect(s.getTemplate('std')!.version).toBe(3);
    expect(s.getTemplate('std', 2)!.version).toBe(2);
    expect(s.getTemplate('std', 9)).toBeUndefined();
  });

  it('快照：成功的保留最近 5 份，失败的只留最新一条', () => {
    let t = 0;
    const s = new Store(':memory:', () => t);
    for (let i = 0; i < 8; i++) s.addSnapshot({ ownerKind: 'source', ownerId: 'a', url: 'u', fetchedAt: ++t, ok: true, body: `b${i}`, hash: `h${i}` });
    for (let i = 0; i < 3; i++) s.addSnapshot({ ownerKind: 'source', ownerId: 'a', url: 'u', fetchedAt: ++t, ok: false, error: `e${i}` });
    expect(s.countSnapshots('source', 'a', 'u')).toEqual({ ok: 5, failed: 1 });
    expect(s.latestSnapshot('source', 'a', 'u')!.body).toBe('b7');
    expect(s.latestSnapshot('source', 'a', 'u', false)!.error).toBe('e2');
  });

  it('token、最近一次成功渲染、访问日志', () => {
    const s = new Store(':memory:', () => 42);
    s.putToken({ token: 'tk', profileId: 'p', label: 'Mac' });
    expect(s.getToken('tk')).toEqual({ token: 'tk', profileId: 'p', label: 'Mac' });
    s.putLastGood('p', 'mihomo', { yaml: 'a' });
    expect(s.getLastGood('p', 'mihomo')).toEqual({ renderedAt: 42, data: { yaml: 'a' } });
    s.logAccess({ token: 'tk', profileId: 'p', at: 1, ua: 'clash.meta', client: 'mihomo', status: 200, ms: 3, warnings: 0, source: 'fresh' });
    expect(s.recentAccess('p')).toHaveLength(1);
  });
});
