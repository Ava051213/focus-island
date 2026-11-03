import { describe, expect, it } from 'vitest'
import {
  createIdleState,
  isPausedStatus,
  remainingBefore,
  transition,
  type TimerState,
} from '../machine'

const NOW = 1_800_000_000_000
const FOCUS_MS = 25 * 60 * 1000
const BREAK_MS = 5 * 60 * 1000

function expectOk(result: ReturnType<typeof transition>): TimerState {
  if (!result.ok) throw new Error(`expected transition to succeed, got ${result.reason}`)
  return result.state
}

function startFocus(now: number = NOW): TimerState {
  return expectOk(transition(createIdleState(FOCUS_MS, FOCUS_MS), {
    event: 'START',
    now,
    payload: {
      plannedDurationMs: FOCUS_MS,
      roundId: 'round-1',
      taskId: 'memo-1',
      taskTitle: '写测试',
    },
  }))
}

describe('timer machine', () => {
  it('合法转移：idle START 后进入 focus，deadline 由开始时间加计划时长得出', () => {
    const state = startFocus()

    expect(state.status).toBe('focus')
    expect(state.phase).toBe('focus')
    expect(state.taskId).toBe('memo-1')
    expect(state.roundId).toBe('round-1')
    expect(state.startedAt).toBe(NOW)
    expect(state.deadline).toBe(NOW + FOCUS_MS)
    expect(state.remainingMs).toBe(FOCUS_MS)
    expect(state.accumulatedPauseMs).toBe(0)
  })

  it('暂停保存剩余与暂停时刻，恢复按当前时间重算 deadline', () => {
    const running = startFocus()
    const paused = expectOk(transition(running, { event: 'PAUSE', now: NOW + 10_000 }))

    expect(paused.status).toBe('focusPaused')
    expect(isPausedStatus(paused.status)).toBe(true)
    expect(paused.deadline).toBeNull()
    expect(paused.remainingMs).toBe(FOCUS_MS - 10_000)
    expect(paused.pausedAt).toBe(NOW + 10_000)

    const resumed = expectOk(transition(paused, { event: 'RESUME', now: NOW + 70_000 }))

    expect(resumed.status).toBe('focus')
    expect(resumed.remainingMs).toBe(FOCUS_MS - 10_000)
    expect(resumed.deadline).toBe(NOW + 70_000 + FOCUS_MS - 10_000)
    expect(resumed.accumulatedPauseMs).toBe(60_000)
    expect(remainingBefore(resumed, NOW + 70_000)).toBe(FOCUS_MS - 10_000)
  })

  it('非法转移被明确拒绝，状态不被静默改坏', () => {
    const idle = createIdleState(FOCUS_MS, FOCUS_MS)
    const running = startFocus()
    const completed = expectOk(transition(running, { event: 'COMPLETE', now: NOW + FOCUS_MS }))

    expect(transition(idle, { event: 'PAUSE', now: NOW })).toEqual({ ok: false, reason: 'INVALID_TRANSITION' })
    expect(transition(idle, { event: 'RESUME', now: NOW })).toEqual({ ok: false, reason: 'INVALID_TRANSITION' })
    expect(transition(idle, { event: 'COMPLETE', now: NOW })).toEqual({ ok: false, reason: 'INVALID_TRANSITION' })
    expect(transition(idle, { event: 'RESET', now: NOW })).toEqual({ ok: false, reason: 'INVALID_TRANSITION' })
    expect(transition(running, { event: 'START', now: NOW, payload: { plannedDurationMs: FOCUS_MS, roundId: 'round-2' } }))
      .toEqual({ ok: false, reason: 'INVALID_TRANSITION' })
    expect(transition(running, { event: 'RESUME', now: NOW }))
      .toEqual({ ok: false, reason: 'INVALID_TRANSITION' })
    expect(transition(completed, { event: 'COMPLETE', now: NOW + FOCUS_MS + 1 }))
      .toEqual({ ok: false, reason: 'INVALID_TRANSITION' })
  })

  it('COMPLETE 只生效一次，并产生 phase-completed 效果', () => {
    const running = startFocus()
    const result = transition(running, { event: 'COMPLETE', now: NOW + FOCUS_MS })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.status).toBe('completed')
    expect(result.state.remainingMs).toBe(0)
    expect(result.state.deadline).toBeNull()
    expect(result.effects).toEqual([{
      type: 'phase-completed',
      phase: 'focus',
      taskId: 'memo-1',
      taskTitle: '写测试',
      roundId: 'round-1',
      plannedDurationMs: FOCUS_MS,
      startedAt: NOW,
      remainingMs: 0,
    }])

    expect(transition(result.state, { event: 'COMPLETE', now: NOW + FOCUS_MS + 1 }))
      .toEqual({ ok: false, reason: 'INVALID_TRANSITION' })
  })

  it('SKIP 记录跳过效果，focus 跳到 break，break 回到 idle', () => {
    const running = startFocus()
    const skipped = transition(running, {
      event: 'SKIP',
      now: NOW + 5 * 60 * 1000,
      payload: { plannedDurationMs: BREAK_MS },
    })

    expect(skipped.ok).toBe(true)
    if (!skipped.ok) return
    expect(skipped.state.status).toBe('break')
    expect(skipped.state.phase).toBe('break')
    expect(skipped.state.taskId).toBe('memo-1')
    expect(skipped.state.roundId).toBeNull()
    expect(skipped.state.deadline).toBe(NOW + 5 * 60 * 1000 + BREAK_MS)
    expect(skipped.effects[0]).toMatchObject({
      type: 'phase-skipped',
      phase: 'focus',
      roundId: 'round-1',
      remainingMs: FOCUS_MS - 5 * 60 * 1000,
    })

    const backToIdle = transition(skipped.state, {
      event: 'SKIP',
      now: NOW + 6 * 60 * 1000,
      payload: { plannedDurationMs: FOCUS_MS },
    })
    expect(backToIdle.ok).toBe(true)
    if (!backToIdle.ok) return
    expect(backToIdle.state.status).toBe('idle')
    expect(backToIdle.state.taskId).toBeNull()
    expect(backToIdle.state.remainingMs).toBe(FOCUS_MS)
    expect(backToIdle.effects[0]).toMatchObject({ type: 'phase-skipped', phase: 'break' })
  })

  it('RESET 回到 idle，completed 后允许直接开始休息', () => {
    const running = startFocus()
    const resetState = expectOk(transition(running, {
      event: 'RESET',
      now: NOW + 60_000,
      payload: { plannedDurationMs: FOCUS_MS },
    }))
    expect(resetState.status).toBe('idle')
    expect(resetState.remainingMs).toBe(FOCUS_MS)
    expect(resetState.taskId).toBeNull()

    const completed = expectOk(transition(running, { event: 'COMPLETE', now: NOW + FOCUS_MS }))
    const breakState = expectOk(transition(completed, {
      event: 'START',
      now: NOW + FOCUS_MS,
      payload: { phase: 'break', plannedDurationMs: BREAK_MS },
    }))
    expect(breakState.status).toBe('break')
    expect(breakState.phase).toBe('break')
    expect(breakState.taskId).toBe('memo-1')
    expect(breakState.roundId).toBeNull()
    expect(breakState.deadline).toBe(NOW + FOCUS_MS + BREAK_MS)
  })

  it('RESTORE 只接受进行中的合法快照', () => {
    const restorePayload = {
      status: 'focus' as const,
      phase: 'focus' as const,
      taskId: 'memo-3',
      taskTitle: '继续写',
      roundId: 'round-3',
      plannedDurationMs: FOCUS_MS,
      startedAt: NOW - 10 * 60 * 1000,
      deadline: NOW + 15 * 60 * 1000,
      remainingMs: 15 * 60 * 1000,
      pausedAt: null,
      accumulatedPauseMs: 0,
    }

    const restored = expectOk(transition(createIdleState(FOCUS_MS, FOCUS_MS), {
      event: 'RESTORE',
      now: NOW,
      payload: restorePayload,
    }))
    expect(restored.status).toBe('focus')
    expect(restored.deadline).toBe(NOW + 15 * 60 * 1000)

    expect(transition(startFocus(), { event: 'RESTORE', now: NOW, payload: restorePayload }))
      .toEqual({ ok: false, reason: 'INVALID_TRANSITION' })

    expect(transition(createIdleState(FOCUS_MS, FOCUS_MS), {
      event: 'RESTORE',
      now: NOW,
      payload: { ...restorePayload, deadline: NOW - 1000 },
    })).toEqual({ ok: false, reason: 'INVALID_RESTORE_PAYLOAD' })

    expect(transition(createIdleState(FOCUS_MS, FOCUS_MS), {
      event: 'RESTORE',
      now: NOW,
      payload: {
        ...restorePayload,
        status: 'focusPaused',
        deadline: null,
        remainingMs: 15 * 60 * 1000,
        pausedAt: null,
      },
    })).toEqual({ ok: false, reason: 'INVALID_RESTORE_PAYLOAD' })
  })
})
