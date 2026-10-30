import { describe, expect, it } from 'vitest';
import { nextDialogSession, updateDialogSession } from './dialogDraft.ts';

const source = () => ({ name: '原名称', members: [{ ref: { id: '节点一' } }], test: { interval: 300 } });

describe('弹窗草稿的事务边界', () => {
  it('嵌套成员与配置均独立于外部数据', () => {
    const external = source();
    const session = nextDialogSession(undefined, true, external, '组一');
    session.draft.members[0]!.ref.id = '仅在弹窗内';
    session.draft.test.interval = 900;
    session.draft.members.push({ ref: { id: '新成员' } });
    expect(external).toEqual(source());
  });
  it('外部刷新不覆盖编辑，关闭保留完整内容，重开取最新外部数据', () => {
    let session = nextDialogSession(undefined, true, source(), '组一');
    session = updateDialogSession(session, session.generation, value => ({ ...value, name: '未保存' }));
    const refreshed = { ...source(), name: '外部新版本' };
    expect(nextDialogSession(session, true, refreshed, '组一')).toBe(session);
    const closed = nextDialogSession(session, false, refreshed);
    expect(closed.draft).toBe(session.draft);
    const reopened = nextDialogSession(closed, true, refreshed, '组一');
    expect(reopened.draft).toEqual(refreshed);
    expect(reopened.draft).not.toBe(refreshed);
  });
  it('切换编辑对象时重新初始化，不能继承上个对象草稿', () => {
    const first = nextDialogSession(undefined, true, source(), '组一');
    first.draft.name = '放弃的内容';
    const second = nextDialogSession(first, true, source(), '组二');
    expect(second.draft).toEqual(source());
    expect(second.generation).not.toBe(first.generation);
  });
  it('关闭后及重开后拒绝旧会话的异步结果', () => {
    const first = nextDialogSession(undefined, true, source(), '组一');
    const closed = nextDialogSession(first, false, source());
    const late = { ...source(), name: '过期解析结果' };
    expect(updateDialogSession(closed, first.generation, late)).toBe(closed);
    const reopened = nextDialogSession(closed, true, source(), '组一');
    expect(updateDialogSession(reopened, first.generation, late)).toBe(reopened);
    expect(updateDialogSession(reopened, reopened.generation, late).draft.name).toBe('过期解析结果');
  });
  it('连续编辑使用当前草稿，显式保存的副本与退场草稿相互隔离', () => {
    let session = nextDialogSession(undefined, true, source());
    session = updateDialogSession(session, session.generation, value => ({ ...value, name: '已编辑' }));
    session = updateDialogSession(session, session.generation, value => ({ ...value, test: { interval: 600 } }));
    const saved = structuredClone(session.draft);
    session.draft.members[0]!.ref.id = '退场时变化';
    expect(saved).toEqual({ ...source(), name: '已编辑', test: { interval: 600 } });
  });
});
