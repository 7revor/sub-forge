import { describe, expect, it } from 'vitest';
import { baseEditorFor, basePatchKey } from './baseClient.ts';
describe('客户端基础配置编辑', () => {
  it.each(['surge', 'loon'] as const)('%s 表单与 INI 往返保留 false、0、列表和域名映射', client => {
    const editor = baseEditorFor(client);
    const value = { general: { ipv6: false, 'test-timeout': 0, 'dns-server': ['system', '1.1.1.1'] }, host: { 'example.test': '192.0.2.1' } };
    expect(editor.fromRaw(editor.toRaw(value))).toEqual({ ok: true, value });
    expect(basePatchKey('surge')).toBe('surgePatch');
    expect(basePatchKey('loon')).toBe('loonPatch');
    expect(basePatchKey('stash')).toBe('stashPatch');
    expect(basePatchKey('mihomo')).toBe('patch');
    expect(editor.fromRaw('[Proxy]\n节点 = direct').ok).toBe(false);
    expect(editor.recoverForm('[Proxy]\n错误', value).value).toEqual(value);
  });
  it('禁止换行注入，列表的引号可往返，空配置保持为空', () => {
    const editor = baseEditorFor('surge');
    expect(() => editor.toRaw({ general: { loglevel: 'notify\n[Proxy]' } })).toThrow();
    expect(editor.fromRaw('')).toEqual({ ok: true, value: {} });
    const value = { general: { 'encrypted-dns-server': ['https://example.test/a,b'] } };
    expect(editor.fromRaw(editor.toRaw(value))).toEqual({ ok: true, value });
  });
});
it('公共配置原文校验和恢复不把非法字段变成有效草稿', () => {
  const editor = baseEditorFor('common'), previous = { dnsIpv6: false, httpPort: 0 };
  expect(editor.fromRaw(editor.toRaw(previous))).toEqual({ ok: true, value: previous });
  expect(editor.fromRaw('unknown: true').ok).toBe(false);
  expect(editor.recoverForm('unknown: true', previous)).toMatchObject({ value: previous, notes: [expect.stringContaining('未知公共字段')] });
  expect(basePatchKey('common')).toBe('common');
});
