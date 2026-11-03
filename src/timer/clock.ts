/**
 * 计时时钟（纯逻辑）
 *
 * 剩余时间只认 `deadline - now`，不做累加；
 * 暂停时用冻结的 remainingMs，恢复时由状态机重算 deadline。
 */

import { isRunningStatus, type TimerState } from './machine'

/** 剩余时间比上次多出这么多，视为系统时间被回拨 */
export const CLOCK_ROLLBACK_TOLERANCE_MS = 2000

export interface ClockObservation {
  now: number
  /** 上一次观测到的剩余毫秒，用来识别时间回拨 */
  previousRemainingMs?: number | null
}

export interface ClockEvaluation {
  /** 展示用剩余毫秒，按秒向上取整 */
  remainingMs: number
  /** 展示用剩余秒数 */
  displaySeconds: number
  /** 检测到时间回拨，remainingMs 已按上次值重锚 */
  clockAnomaly: boolean
  /** 需要写回状态的新 deadline；null 表示无需调整 */
  nextDeadline: number | null
  shouldComplete: boolean
}

function exactRemainingMs(state: TimerState, now: number): number {
  if (isRunningStatus(state.status) && state.deadline !== null) {
    return Math.max(0, state.deadline - now)
  }
  return Math.max(0, state.remainingMs)
}

/** 向上取整到秒，避免 24:59.2 显示成 24:59 */
function roundUpToSecond(ms: number): number {
  return Math.max(0, Math.ceil(ms / 1000) * 1000)
}

export function evaluateClock(state: TimerState, observation: ClockObservation): ClockEvaluation {
  const { now, previousRemainingMs } = observation

  if (!isRunningStatus(state.status)) {
    const remainingMs = roundUpToSecond(state.remainingMs)
    return {
      remainingMs,
      displaySeconds: Math.floor(remainingMs / 1000),
      clockAnomaly: false,
      nextDeadline: null,
      shouldComplete: false,
    }
  }

  const exact = exactRemainingMs(state, now)
  const previous = previousRemainingMs ?? null

  // 系统时间被调回到过去时，remaining 会异常变大。
  // 此时不信任新读数，按上一次的剩余时间把 deadline 重新锚到当前时刻。
  if (previous !== null && exact > previous + CLOCK_ROLLBACK_TOLERANCE_MS) {
    const clamped = roundUpToSecond(previous)
    return {
      remainingMs: clamped,
      displaySeconds: Math.floor(clamped / 1000),
      clockAnomaly: true,
      nextDeadline: now + clamped,
      shouldComplete: clamped <= 0,
    }
  }

  const remainingMs = roundUpToSecond(exact)
  return {
    remainingMs,
    displaySeconds: Math.floor(remainingMs / 1000),
    clockAnomaly: false,
    nextDeadline: null,
    shouldComplete: remainingMs <= 0,
  }
}

/**
 * 本轮已经专注了多久（毫秒）。
 * 暂停不计入，系统休眠导致 deadline 大幅超时也会被钳制到计划时长。
 */
export function elapsedMs(state: TimerState, now: number): number {
  if (state.status === 'idle' || state.plannedDurationMs <= 0) return 0
  const remaining = state.status === 'completed' ? 0 : exactRemainingMs(state, now)
  const elapsed = state.plannedDurationMs - remaining
  return Math.min(state.plannedDurationMs, Math.max(0, elapsed))
}
