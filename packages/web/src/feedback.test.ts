import { afterEach, describe, expect, it } from 'vitest';
import { alertError, feedbackStore, notifySuccess } from './feedback.ts';

afterEach(() => { for (const item of feedbackStore.getSnapshot()) feedbackStore.dismiss(item.id); });

describe('全局操作反馈', () => {
  it('并发错误依次保留，关闭前一条不会丢失后一条', () => {
    alertError(new Error('保存失败'));
    alertError(new Error('读取失败'));
    const [first, second] = feedbackStore.getSnapshot();
    feedbackStore.dismiss(first!.id);
    expect(feedbackStore.getSnapshot()).toEqual([second]);
  });
  it('mutation 和页面观察同一个错误时只显示一次，关闭后不因旧状态重新弹出', () => {
    const error = new Error('保存失败');
    alertError(error); alertError(error);
    expect(feedbackStore.getSnapshot()).toHaveLength(1);
    feedbackStore.dismiss(feedbackStore.getSnapshot()[0]!.id);
    alertError(error);
    expect(feedbackStore.getSnapshot()).toEqual([]);
    alertError(new Error('保存失败'));
    expect(feedbackStore.getSnapshot()).toHaveLength(1);
  });
  it('重复内容同时合并，用户再次尝试后允许相同错误出现', () => {
    alertError('无法解析'); alertError('无法解析');
    expect(feedbackStore.getSnapshot()).toHaveLength(1);
    feedbackStore.dismiss(feedbackStore.getSnapshot()[0]!.id);
    alertError('无法解析');
    expect(feedbackStore.getSnapshot()).toHaveLength(1);
  });
  it('删除失败保留所有引用方，错误内容按文本交给界面展示', () => {
    alertError(Object.assign(new Error('仍被引用'), { details: { referrers: ['订阅一', '<script>测试</script>'] } }));
    expect(feedbackStore.getSnapshot()[0]?.message).toBe('仍被引用：订阅一、<script>测试</script>');
  });
  it('通知与错误互不覆盖，撤销通知能独立失效，取消订阅后不再回调', () => {
    let changes = 0;
    const unsubscribe = feedbackStore.subscribe(() => { changes++; });
    const undo = notifySuccess('已格式化', { label: '撤销', run: () => {} });
    alertError('其他操作失败');
    feedbackStore.dismiss(undo);
    expect(feedbackStore.getSnapshot().map(item => item.kind)).toEqual(['error']);
    expect(changes).toBe(3);
    unsubscribe();
    notifySuccess('已复制');
    expect(changes).toBe(3);
  });
});
