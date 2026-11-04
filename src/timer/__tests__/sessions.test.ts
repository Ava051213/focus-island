import { describe, expect, it } from 'vitest'
import {
  aggregateSessionsByDate,
  aggregateSessionsByTask,
  appendSession,
  buildSession,
  mergeDailyStats,
  sessionLocalDate,
  type Session,
} from '../sessions'

const FOCUS_MS = 25 * 60 * 1000

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'round-1',
    taskId: 'memo-1',
    taskTitle: '写测试',
    startAt: 1_800_000_000_000,
    endAt: 1_800_000_000_000 + FOCUS_MS,
    plannedDuration: 1500,
    actualDuration: 1500,
    status: 'completed',
    interruptReason: null,
    createdAt: 1_800_000_000_000 + FOCUS_MS,
    ...overrides,
  }
}

describe('session records', () => {
  it('buildSession 统一换算成秒，并把实际时长钳制到计划时长', () => {
    const completed = buildSession({
      roundId: 'round-1',
      taskId: 'memo-1',
      taskTitle: '写测试',
      startAt: 1_800_000_000_000,
      endAt: 1_800_000_000_000 + FOCUS_MS,
      plannedDurationMs: FOCUS_MS,
      actualDurationMs: FOCUS_MS,
      status: 'completed',
    })

    expect(completed.id).toBe('round-1')
    expect(completed.plannedDuration).toBe(1500)
    expect(completed.actualDuration).toBe(1500)

    const clamped = buildSession({
      id: 'round-2',
      taskId: null,
      startAt: 1_800_000_000_000,
      endAt: 1_800_000_000_000 + 30 * 60 * 1000,
      plannedDurationMs: FOCUS_MS,
      actualDurationMs: 30 * 60 * 1000,
      status: 'interrupted',
      interruptReason: 'user',
    })
    expect(clamped.actualDuration).toBe(1500)
    expect(clamped.taskId).toBeNull()
    expect(clamped.interruptReason).toBe('user')
  })

  it('跳过与完成的 Session status 明确不同', () => {
    const completed = buildSession({
      id: 'a',
      taskId: 'memo-1',
      startAt: 1_800_000_000_000,
      endAt: 1_800_000_000_000 + FOCUS_MS,
      plannedDurationMs: FOCUS_MS,
      actualDurationMs: FOCUS_MS,
      status: 'completed',
    })
    const skipped = buildSession({
      id: 'b',
      taskId: 'memo-1',
      startAt: 1_800_000_000_000,
      endAt: 1_800_000_000_000 + 5 * 60 * 1000,
      plannedDurationMs: FOCUS_MS,
      actualDurationMs: 5 * 60 * 1000,
      status: 'skipped',
    })

    expect(completed.status).toBe('completed')
    expect(skipped.status).toBe('skipped')
    expect(skipped.actualDuration).toBe(300)
  })

  it('同一轮重复写入会被去重，只保留第一条', () => {
    const first = makeSession()
    const result = appendSession([], first)
    expect(result.appended).toBe(true)
    expect(result.sessions).toHaveLength(1)

    const duplicate = appendSession(result.sessions, { ...first, actualDuration: 100 })
    expect(duplicate.appended).toBe(false)
    expect(duplicate.sessions).toHaveLength(1)
    expect(duplicate.sessions[0].actualDuration).toBe(1500)

    const next = appendSession(result.sessions, { ...first, id: 'round-2' })
    expect(next.appended).toBe(true)
    expect(next.sessions).toHaveLength(2)
  })

  it('按结束日的本地日期聚合，跨零点归属完成日', () => {
    const beforeMidnight = new Date(2026, 10, 3, 23, 59, 59)
    const afterMidnight = new Date(2026, 10, 4, 0, 0, 0)

    const late = makeSession({ id: 'late', endAt: beforeMidnight.getTime() })
    const early = makeSession({ id: 'early', endAt: afterMidnight.getTime() })

    expect(sessionLocalDate(late)).toBe('2026-11-03')
    expect(sessionLocalDate(early)).toBe('2026-11-04')

    const aggregate = aggregateSessionsByDate([late, early, makeSession({
      id: 'skip',
      endAt: beforeMidnight.getTime(),
      status: 'skipped',
    })], '2026-11-03')

    expect(aggregate.completedCount).toBe(1)
    expect(aggregate.skippedCount).toBe(1)
    expect(aggregate.focusMinutes).toBe(25)
  })

  it('按小记聚合时只统计完成的轮次，跳过和中断不计入', () => {
    const today = new Date(2026, 10, 4, 12, 0, 0).getTime()
    const yesterday = new Date(2026, 10, 3, 12, 0, 0).getTime()

    const sessions: Session[] = [
      makeSession({ id: 'a', taskId: 'memo-1', endAt: today }),
      makeSession({ id: 'b', taskId: 'memo-1', endAt: yesterday }),
      makeSession({ id: 'c', taskId: 'memo-1', status: 'skipped', endAt: today }),
      makeSession({ id: 'd', taskId: 'memo-1', status: 'interrupted', endAt: today }),
      makeSession({ id: 'e', taskId: 'memo-2', endAt: today }),
      makeSession({ id: 'f', taskId: null, endAt: today }),
    ]

    const stats = aggregateSessionsByTask(sessions, '2026-11-04')

    expect(stats.get('memo-1')).toEqual({ pomodoros: 2, todayPomodoros: 1 })
    expect(stats.get('memo-2')).toEqual({ pomodoros: 1, todayPomodoros: 1 })
    expect(stats.has('')).toBe(false)
    expect(stats.size).toBe(2)
  })

  it('旧累加统计与 Session 合并不重复计数，跳过/中断不进番茄数', () => {
    const day3Late = new Date(2026, 10, 3, 23, 59, 59).getTime()
    const day4Early = new Date(2026, 10, 4, 0, 0, 0).getTime()

    const sessions: Session[] = [
      makeSession({ id: 's1', endAt: day3Late, status: 'completed' }),
      makeSession({ id: 's2', endAt: day3Late, status: 'interrupted', actualDuration: 600 }),
      makeSession({ id: 's3', endAt: day3Late, status: 'skipped', actualDuration: 300 }),
      makeSession({ id: 's4', endAt: day4Early, status: 'completed' }),
    ]

    const merged = mergeDailyStats([
      { date: '2026-11-03', pomodoros: 2, focusMinutes: 50, tasksCompleted: 1 },
    ], sessions)

    expect(merged).toEqual([
      { date: '2026-11-03', pomodoros: 3, focusMinutes: 75, tasksCompleted: 1 },
      { date: '2026-11-04', pomodoros: 1, focusMinutes: 25, tasksCompleted: 0 },
    ])
  })
})
