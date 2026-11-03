import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeClipboard } from './useClipboard.ts';

function stubDom(execResult: boolean, dialogs: unknown[] = []) {
  const textarea = { value: '', style: {}, setAttribute: vi.fn(), focus: vi.fn(), select: vi.fn(), setSelectionRange: vi.fn(), remove: vi.fn() };
  const body = { append: vi.fn() };
  const execCommand = vi.fn(() => execResult);
  vi.stubGlobal('HTMLElement', class {});
  vi.stubGlobal('document', { activeElement: null, body, getSelection: () => null, createElement: () => textarea, querySelectorAll: () => dialogs, execCommand });
  return { textarea, body, execCommand };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('写入剪贴板', () => {
  it('安全上下文优先用 Clipboard API，不碰选区', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { execCommand } = stubDom(true);
    await writeClipboard('链接');
    expect(writeText).toHaveBeenCalledWith('链接');
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('HTTP 下没有 navigator.clipboard 时退回选区复制并清理文本框', async () => {
    vi.stubGlobal('navigator', {});
    const { textarea, body, execCommand } = stubDom(true);
    await writeClipboard('http://192.168.1.2/subs');
    expect(textarea.value).toBe('http://192.168.1.2/subs');
    expect(body.append).toHaveBeenCalledWith(textarea);
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(textarea.remove).toHaveBeenCalled();
  });

  it('打开弹窗时文本框放进最上层弹窗，避免被焦点陷阱抢走焦点', async () => {
    vi.stubGlobal('navigator', {});
    const lower = { append: vi.fn() };
    const top = { append: vi.fn() };
    const { textarea, body } = stubDom(true, [lower, top]);
    await writeClipboard('文本');
    expect(top.append).toHaveBeenCalledWith(textarea);
    expect(lower.append).not.toHaveBeenCalled();
    expect(body.append).not.toHaveBeenCalled();
  });

  it('Clipboard API 被拒时尝试回退，回退成功即成功', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => { throw new Error('权限被拒绝'); }) } });
    const { execCommand } = stubDom(true);
    await expect(writeClipboard('文本')).resolves.toBeUndefined();
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('两种方式都失败时抛出原始原因，不伪报成功', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => { throw new Error('权限被拒绝'); }) } });
    stubDom(false);
    await expect(writeClipboard('文本')).rejects.toThrow('权限被拒绝');
    vi.stubGlobal('navigator', {});
    stubDom(false);
    await expect(writeClipboard('文本')).rejects.toThrow('浏览器拒绝了复制操作');
  });
});
