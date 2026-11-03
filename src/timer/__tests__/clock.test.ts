import { describe, expect, it } from 'vitest'
import {
  CLOCK_ROLLBACK_TOLERANCE_MS,
  evaluateClock,
  elapsedMs,
} from '../clock'
import {
  createIdleState,
  transition,
  type TimerState,
} from '../machine'

const NOW = 1_800_000_000_000
const FOCUS_MS = 25 * 60 * 1000

function startFocus(): TimerState {
  const result = transition(createIdleState(FOCUS_MS, FOCUS_MS), {
    event: 'START',
    now: NOW,
    payload: { plannedDurationMs: FOCUS_MS, roundId: 'round-1', taskId: 'memo-1' },
  })
  if (!result.ok) throw new Error(result.reason)
  return result.state
}

describe('timer clock', () => {
  it('剩余时间按 deadline 计算，不依赖累加', () => {
    const state = startFocus()
    const evaluation = evaluateClock(state, { now: NOW + 10 * 60 * 1000 })

    expect(evaluation.remainingMs).toBe(15 * 60 * 1000)
    expect(evaluation.displaySeconds).toBe(15 * 60)
    expect(evaluation.shouldComplete).toBe(false)
    expect(evaluation.clockAnomaly).toBe(false)
  })

  it('超过 deadline 时剩余归零且只应触发一次完成', () => {
    const state = startFocus()
    const evaluation = evaluateClock(state, { now: NOW + FOCUS_MS + 1000 })

    expect(evaluation.remainingMs).toBe(0)
    expect(evaluation.displaySeconds).toBe(0)
    expect(evaluation.shouldComplete).toBe(true)
  })

  it('暂停期间剩余时间保持冻结', () => {
    const running = startFocus()
    const pausedResult = transition(running, { event: 'PAUSE', now: NOW + 10 * 60 * 1000 })
    if (!pausedResult.ok) throw new Error(pausedResult.reason)

    const evaluation = evaluateClock(pausedResult.state, { now: NOW + 3 * 60 * 60 * 1000 })
    expect(evaluation.remainingMs).toBe(15 * 60 * 1000)
    expect(evaluation.shouldComplete).toBe(false)
  })

  it('系统时间回拨时按上次剩余时间重锚 deadline', () => {
    const state = startFocus()
    const previousRemainingMs = 15 * 60 * 1000
    const rolledBackNow = NOW + 5 * 60 * 1000

    const evaluation = evaluateClock(
      { ...state, deadline: rolledBackNow + previousRemainingMs + 5 * 60 * 1000 },
      { now: rolledBackNow, previousRemainingMs },
    )

    // 原始读数会比上次多出 5 分钟，超过容差，判定为回拨
    expect(evaluation.clockAnomaly).toBe(true)
    expect(evaluation.remainingMs).toBe(previousRemainingMs)
    expect(evaluation.nextDeadline).toBe(rolledBackNow + previousRemainingMs)
    expect(evaluation.shouldComplete).toBe(false)
  })

  it('回拨幅度在容差内时不误报', () => {
    const state = startFocus()
    const previousRemainingMs = 15 * 60 * 1000
    const evaluation = evaluateClock(state, {
      now: NOW + 10 * 60 * 1000,
      previousRemainingMs: previousRemainingMs - 1000,
    })

    expect(evaluation.clockAnomaly).toBe(false)
    expect(evaluation.remainingMs).toBe(previousRemainingMs)
    expect(CLOCK_ROLLBACK_TOLERANCE_MS).toBe(2000)
  })

  it('实际专注时长不含暂停，且系统休眠后不会超过计划时长', () => {
    const running = startFocus()
    expect(elapsedMs(running, NOW + 10 * 60 * 1000)).toBe(10 * 60 * 1000)

    const pausedResult = transition(running, { event: 'PAUSE', now: NOW + 10 * 60 * 1000 })
    if (!pausedResult.ok) throw new Error(pausedResult.reason)
    expect(elapsedMs(pausedResult.state, NOW + 5 * 60 * 60 * 1000)).toBe(10 * 60 * 1000)

    expect(elapsedMs(running, NOW + 3 * 24 * 60 * 60 * 1000)).toBe(FOCUS_MS)
  })
})
