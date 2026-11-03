import { describe, expect, it } from 'vitest'
import {
  applyRecovery,
  createSnapshot,
  parseSnapshot,
  planRecovery,
} from '../snapshot'
import {
  createIdleState,
  transition,
  type TimerState,
} from '../machine'

const NOW = 1_800_000_000_000
const FOCUS_MS = 25 * 60 * 1000
const BREAK_MS = 5 * 60 * 1000

function startFocus(): TimerState {
  const result = transition(createIdleState(FOCUS_MS, FOCUS_MS), {
    event: 'START',
    now: NOW,
    payload: {
      plannedDurationMs: FOCUS_MS,
      roundId: 'round-1',
      taskId: 'memo-1',
      taskTitle: '写测试',
    },
  })
  if (!result.ok) throw new Error(result.reason)
  return result.state
}

function pauseAt(state: TimerState, now: number): TimerState {
  const result = transition(state, { event: 'PAUSE', now })
  if (!result.ok) throw new Error(result.reason)
  return result.state
}

describe('timer snapshot', () => {
  it('进行中的 focus 会生成快照，idle/completed 不生成', () => {
    const snapshot = createSnapshot(startFocus(), NOW)
    expect(snapshot).toMatchObject({
      status: 'focus',
      phase: 'focus',
      taskId: 'memo-1',
      roundId: 'round-1',
      plannedDurationMs: FOCUS_MS,
      remainingMs: FOCUS_MS,
      deadline: NOW + FOCUS_MS,
    })

    expect(createSnapshot(createIdleState(FOCUS_MS, FOCUS_MS), NOW)).toBeNull()

    const completed = transition(startFocus(), { event: 'COMPLETE', now: NOW + FOCUS_MS })
    if (!completed.ok) throw new Error(completed.reason)
    expect(createSnapshot(completed.state, NOW + FOCUS_MS)).toBeNull()
  })

  it('快照逐字段校验，非法数据不会被当成可恢复状态', () => {
    expect(parseSnapshot(null)).toBeNull()
    expect(parseSnapshot({ status: 'focus' })).toBeNull()
    expect(parseSnapshot({ ...createSnapshot(startFocus(), NOW)!, status: 'idle' })).toBeNull()
    expect(planRecovery({ status: 'focus' }, NOW)).toEqual({ kind: 'none', reason: 'invalid' })
    expect(planRecovery(null, NOW)).toEqual({ kind: 'none', reason: 'missing' })
  })

  it('仍在进行中的快照返回 active，并要求继续/放弃', () => {
    const plan = planRecovery(createSnapshot(startFocus(), NOW), NOW + 10 * 60 * 1000)

    expect(plan.kind).toBe('active')
    if (plan.kind !== 'active') return
    expect(plan.remainingMs).toBe(15 * 60 * 1000)
    expect(plan.prompt).toBe('continue-or-discard')
  })

  it('已超过 deadline 的快照返回 expired，并要求继续/放弃并记中断', () => {
    const plan = planRecovery(createSnapshot(startFocus(), NOW), NOW + FOCUS_MS + 60_000)

    expect(plan.kind).toBe('expired')
    if (plan.kind !== 'expired') return
    expect(plan.prompt).toBe('continue-or-interrupt')
    expect(plan.phase).toBe('focus')
  })

  it('暂停中的快照仍视为进行中，恢复后保留暂停账本', () => {
    const paused = pauseAt(startFocus(), NOW + 10 * 60 * 1000)
    const snapshot = createSnapshot(paused, NOW + 10 * 60 * 1000)
    const plan = planRecovery(snapshot, NOW + 60 * 60 * 1000)

    expect(plan.kind).toBe('active')
    if (plan.kind !== 'active') return

    const outcome = applyRecovery(plan, 'continue', NOW + 60 * 60 * 1000)
    expect(outcome.action).toBe('restore')
    if (outcome.action !== 'restore') return
    expect(outcome.restore.status).toBe('focusPaused')
    expect(outcome.restore.remainingMs).toBe(15 * 60 * 1000)
    expect(outcome.restore.pausedAt).toBe(NOW + 10 * 60 * 1000)
    expect(outcome.restore.deadline).toBeNull()
  })

  it('active 继续时按当前时刻重锚 deadline', () => {
    const plan = planRecovery(createSnapshot(startFocus(), NOW), NOW + 20 * 60 * 1000)
    if (plan.kind !== 'active') throw new Error('expected active plan')

    const outcome = applyRecovery(plan, 'continue', NOW + 20 * 60 * 1000)
    expect(outcome.action).toBe('restore')
    if (outcome.action !== 'restore') return
    expect(outcome.restore.status).toBe('focus')
    expect(outcome.restore.deadline).toBe(NOW + 20 * 60 * 1000 + 5 * 60 * 1000)
    expect(outcome.restore.remainingMs).toBe(5 * 60 * 1000)
  })

  it('提示停留太久、点击时已过 deadline，按过期结果处理', () => {
    const plan = planRecovery(createSnapshot(startFocus(), NOW), NOW + 10 * 60 * 1000)
    if (plan.kind !== 'active') throw new Error('expected active plan')

    const continued = applyRecovery(plan, 'continue', NOW + FOCUS_MS + 60_000)
    expect(continued.action).toBe('completed')

    const discarded = applyRecovery(plan, 'discard', NOW + FOCUS_MS + 60_000)
    expect(discarded.action).toBe('discarded')
    if (discarded.action !== 'discarded') return
    expect(discarded.session).toMatchObject({
      status: 'interrupted',
      interruptReason: 'expired-discarded',
    })
  })

  it('active 放弃写一条 interrupted Session，不静默丢弃', () => {
    const plan = planRecovery(createSnapshot(startFocus(), NOW), NOW + 10 * 60 * 1000)
    if (plan.kind !== 'active') throw new Error('expected active plan')

    const outcome = applyRecovery(plan, 'discard', NOW + 10 * 60 * 1000)
    expect(outcome.action).toBe('discarded')
    if (outcome.action !== 'discarded') return
    expect(outcome.session).toMatchObject({
      id: 'round-1',
      taskId: 'memo-1',
      status: 'interrupted',
      interruptReason: 'restart-discarded',
      plannedDuration: 1500,
      actualDuration: 600,
    })
  })

  it('expired 继续记为 completed，放弃记为 interrupted', () => {
    const startState = startFocus()
    const expiredPlan = planRecovery(
      createSnapshot(startState, NOW),
      NOW + FOCUS_MS + 60_000,
    )
    if (expiredPlan.kind !== 'expired') throw new Error('expected expired plan')

    const continued = applyRecovery(expiredPlan, 'continue', NOW + FOCUS_MS + 60_000)
    expect(continued.action).toBe('completed')
    if (continued.action !== 'completed') return
    expect(continued.session).toMatchObject({
      status: 'completed',
      plannedDuration: 1500,
      actualDuration: 1500,
      endAt: NOW + FOCUS_MS,
    })

    const discarded = applyRecovery(expiredPlan, 'discard', NOW + FOCUS_MS + 60_000)
    expect(discarded.action).toBe('discarded')
    if (discarded.action !== 'discarded') return
    expect(discarded.session).toMatchObject({
      status: 'interrupted',
      interruptReason: 'expired-discarded',
      plannedDuration: 1500,
      actualDuration: 1500,
    })
  })

  it('休息阶段不写 Session', () => {
    const breakState = transition(startFocus(), {
      event: 'SKIP',
      now: NOW + 5 * 60 * 1000,
      payload: { plannedDurationMs: BREAK_MS },
    })
    if (!breakState.ok) throw new Error(breakState.reason)

    const plan = planRecovery(createSnapshot(breakState.state, NOW + 5 * 60 * 1000), NOW + 20 * 60 * 1000)
    if (plan.kind !== 'expired') throw new Error('expected expired plan')

    const outcome = applyRecovery(plan, 'discard', NOW + 20 * 60 * 1000)
    expect(outcome.action).toBe('discarded')
    if (outcome.action !== 'discarded') return
    expect(outcome.session).toBeNull()
  })
})
