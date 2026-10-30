import { describe, expect, it, vi } from 'vitest';
import { ModalController } from './controller.ts';

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
describe('统一弹窗会话', () => {
  it('连续 show 的触发器在页面时，关闭顶层把焦点还给父弹窗', async () => {
    const trigger = { isConnected: true, focus: vi.fn() };
    const parentContent = { contains: () => false, focus: vi.fn() };
    vi.stubGlobal('document', { activeElement: trigger, querySelector: () => parentContent });
    try {
      const runtime = new ModalController(); const parent = runtime.show('父', {}); const child = runtime.show('子', {});
      const id = runtime.getSnapshot()[1]!.id; runtime.confirm(id, true); runtime.exited(id); await child;
      expect(parentContent.focus).toHaveBeenCalledOnce(); expect(trigger.focus).not.toHaveBeenCalled();
      runtime.cancelAll('unmounted', true); await parent;
    } finally { vi.unstubAllGlobals(); }
  });
  it('入参与确认结果都深拷贝，退场前不结算 Promise', async () => {
    const runtime = new ModalController(); const input = { members: [{ name: '原成员' }] };
    const done = vi.fn(); const result = runtime.show('表单', input).then(done); const session = runtime.getSnapshot()[0]!;
    input.members[0]!.name = '外部刷新'; expect(session.data.members[0].name).toBe('原成员');
    session.data.members[0].name = '草稿'; expect(input.members[0]!.name).toBe('外部刷新');
    runtime.confirm(session.id, session.data); session.data.members[0].name = '关闭后变动'; await Promise.resolve(); expect(done).not.toHaveBeenCalled();
    runtime.exited(session.id); await result; expect(done).toHaveBeenCalledExactlyOnceWith({ status: 'confirmed', data: { members: [{ name: '草稿' }] } });
    runtime.exited(session.id); expect(done).toHaveBeenCalledTimes(1);
  });
  it.each(['dismissed', 'navigation', 'unmounted'] as const)('%s 结束取消 Promise，关闭时保留原始内容', async reason => {
    const runtime = new ModalController(); const promise = runtime.show('编辑', { name: '内容' }); const session = runtime.getSnapshot()[0]!;
    runtime.cancel(session.id, reason); expect(runtime.getSnapshot()[0]!.data.name).toBe('内容'); expect(session.phase).toBe('closing');
    runtime.confirm(session.id, '不能提交'); runtime.exited(session.id); expect(await promise).toEqual({ status: 'cancelled', reason });
  });
  it('保存失败保留草稿和错误，重试成功后才关闭', async () => {
    const runtime = new ModalController(); const submit = vi.fn().mockRejectedValueOnce(new Error('保存失败')).mockResolvedValueOnce(undefined);
    const promise = runtime.show('编辑', { name: '草稿' }, { submit }); const session = runtime.getSnapshot()[0]!;
    await runtime.submit(session.id, () => '结果'); expect(session.phase).toBe('open'); expect(session.error).toBe('保存失败'); expect(session.pending).toBe(false);
    await runtime.submit(session.id, () => '结果'); expect(session.phase).toBe('closing'); runtime.exited(session.id); expect(await promise).toEqual({ status: 'confirmed', data: '结果' });
  });
  it('重复提交只执行一次，提交期间普通关闭被阻止', async () => {
    const runtime = new ModalController(); const gate = deferred<string>(); const submit = vi.fn(); const promise = runtime.show('编辑', {}, { submit }); const session = runtime.getSnapshot()[0]!;
    const saving = runtime.submit(session.id, () => gate.promise); await runtime.submit(session.id, () => '重复'); runtime.cancel(session.id);
    expect(session.phase).toBe('open'); gate.resolve('一次'); await saving; expect(submit).toHaveBeenCalledTimes(1); runtime.exited(session.id); expect((await promise).status).toBe('confirmed');
  });
  it('路由离开中断提交，晚到响应不调用提交动作或影响新会话', async () => {
    const runtime = new ModalController(); const gate = deferred<string>(); const submit = vi.fn(); const first = runtime.show('编辑', {}, { submit }); const old = runtime.getSnapshot()[0]!;
    const saving = runtime.submit(old.id, () => gate.promise); runtime.cancelAll('navigation'); const next = runtime.show('编辑', { name: '新会话' });
    gate.resolve('旧响应'); await saving; expect(submit).not.toHaveBeenCalled(); expect(old.abort.signal.aborted).toBe(true);
    runtime.exited(old.id); expect((await first).status).toBe('cancelled'); expect(runtime.getSnapshot()[0]!.data.name).toBe('新会话'); runtime.cancelAll('unmounted', true); await next;
  });
  it('嵌套会话独立结算，Host 销毁结束所有剩余 Promise', async () => {
    const runtime = new ModalController(); const parent = runtime.show('父', { name: '父' }); const child = runtime.show('子', { name: '子' }); const [a, b] = runtime.getSnapshot();
    runtime.cancel(b!.id); runtime.exited(b!.id); expect((await child).status).toBe('cancelled'); expect(runtime.active(a!.id)).toBe(true);
    runtime.cancelAll('unmounted', true); expect(await parent).toEqual({ status: 'cancelled', reason: 'unmounted' }); expect(runtime.getSnapshot()).toEqual([]);
  });
  it('已卸载会话的异常不影响新会话', async () => {
    const runtime = new ModalController(); const gate = deferred<void>(); const old = runtime.show('旧', {}); const id = runtime.getSnapshot()[0]!.id;
    const saving = runtime.submit(id, () => gate.promise); runtime.cancelAll('unmounted', true); await old;
    const next = runtime.show('新', {}); gate.reject(new Error('旧请求失败')); await saving; expect(runtime.getSnapshot()[0]!.error).toBeUndefined(); runtime.cancelAll('unmounted', true); await next;
  });
});
