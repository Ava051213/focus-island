import { describe, expect, it } from 'vitest'
import { pickLastUsedMemo } from '../lastTask'
import type { Session } from '../../timer/sessions'

function session(patch: Partial<Session> & Pick<Session, 'id'>): Session {
  return {
    id: patch.id,
    taskId: patch.taskId ?? null,
    taskTitle: patch.taskTitle ?? null,
    startAt: patch.startAt ?? 0,
    endAt: patch.endAt ?? 0,
    plannedDuration: patch.plannedDuration ?? 0,
    actualDuration: patch.actualDuration ?? 0,
    status: patch.status ?? 'completed',
    interruptReason: patch.interruptReason ?? null,
    createdAt: patch.createdAt ?? patch.endAt ?? 0,
  }
}

describe('pickLastUsedMemo', () => {
  it('取最近结束且有 taskId 的 Session 对应备', () => {
    const memos = [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
    ]
    const sessions = [
      session({ id: 's1', taskId: 'a', endAt: 1000 }),
      session({ id: 's2', taskId: 'b', endAt: 2000 }),
    ]

    expect(pickLastUsedMemo(sessions, memos)?.id).toBe('b')
  })

  it('跳过没有 taskId 的 Session', () => {
    const memos = [{ id: 'a', title: 'A' }]
    const sessions = [
      session({ id: 's1', taskId: 'a', endAt: 1000 }),
      session({ id: 's2', taskId: null, endAt: 3000 }),
    ]

    expect(pickLastUsedMemo(sessions, memos)?.id).toBe('a')
  })

  it('上次备已删除时回退为 null', () => {
    const sessions = [session({ id: 's1', taskId: 'missing', endAt: 1000 })]

    expect(pickLastUsedMemo(sessions, [])).toBeNull()
  })

  it('上次备已完成时回退为 null', () => {
    const memos = [{ id: 'a', title: 'A', completedAt: 123 }]
    const sessions = [session({ id: 's1', taskId: 'a', endAt: 1000 })]

    expect(pickLastUsedMemo(sessions, memos)).toBeNull()
  })

  it('没有 Session 时返回 null', () => {
    expect(pickLastUsedMemo([], [{ id: 'a', title: 'A' }])).toBeNull()
  })
})
