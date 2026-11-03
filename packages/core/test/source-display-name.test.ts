import { describe, expect, it } from 'vitest';
import { sourceDisplayName, sourceLabel } from '../src/index.ts';

const remote = (url: string, name?: string) => ({ id: 's', kind: 'remote' as const, format: 'auto' as const, url, name });

describe('来源显示名', () => {
  it('仓库来源显示文件名，忽略旧名称', () => {
    const src = { ...remote('https://raw.test/a/wise.txt', 'zydou · a/wise.txt'), repository: { repo: 'zydou', entry: 'wise', ref: 'main', path: 'a/wise.txt' } };
    expect(sourceDisplayName(src)).toBe('wise.txt');
  });
  it('远程来源显示地址中的文件名，没有文件名时显示完整地址', () => {
    expect(sourceDisplayName(remote('https://x.test/rules/ads%20list.yaml?token=1', '旧名称'))).toBe('ads list.yaml');
    expect(sourceDisplayName(remote('https://x.test/rules?id=1'))).toBe('https://x.test/rules?id=1');
    expect(sourceDisplayName(remote('https://x.test/'))).toBe('https://x.test/');
    expect(sourceDisplayName(remote('https://x.test/bad%zz.txt'))).toBe('https://x.test/bad%zz.txt');
  });
  it('诊断文案中远程来源用完整地址，本地来源用名称', () => {
    expect(sourceLabel(remote('https://x.test/a.txt', '旧名称'))).toBe('https://x.test/a.txt');
    expect(sourceLabel({ id: 'l', kind: 'local', format: 'auto', content: '', name: '常用 AI' })).toBe('常用 AI');
    expect(sourceLabel({ id: 'l', kind: 'local', format: 'auto', content: '' })).toBe('本地规则');
  });
});
