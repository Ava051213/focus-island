/**
 * 进行中快照与恢复决策（纯逻辑）
 *
 * 快照只负责“记录现场”，恢复怎么做由 planRecovery / applyRecovery 决定，
 * 便于单测，不依赖组件生命周期。
 */

import {
  isRecoverableStatus,
  remainingBefore,
  phaseOfStatus,
  type RecoverableStatus,
  type RestorePayload,
  type TimerPhase,
  type TimerState,
} from './machine'
import { buildSession, type Session } from './sessions'

export interface TimerSnapshot {
  status: RecoverableStatus
  phase: TimerPhase
  taskId: string | null
  taskTitle: string | null
  roundId: string | null
  plannedDurationMs: number
  startedAt: number
  deadline: number | null
  remainingMs: number
  pausedAt: number | null
  accumulatedPauseMs: number
  updatedAt: number
}

/** idle / completed 没有可恢复的进行中状态，返回 null */
export function createSnapshot(state: TimerState, now: number): TimerSnapshot | null {
  if (!isRecoverableStatus(state.status)) return null
  if (state.startedAt === null) return null

  const running = state.status === 'focus' || state.status === 'break'
  if (running && state.deadline === null) return null

  return {
    status: state.status,
    phase: state.phase,
    taskId: state.taskId,
    taskTitle: state.taskTitle,
    roundId: state.roundId,
    plannedDurationMs: state.plannedDurationMs,
    startedAt: state.startedAt,
    deadline: running ? state.deadline : null,
    remainingMs: running ? remainingBefore(state, now) : state.remainingMs,
    pausedAt: running ? null : state.pausedAt,
    accumulatedPauseMs: state.accumulatedPauseMs,
    updatedAt: now,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isOptionalString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

/** 文件里的数据不可信，逐字段校验；不合法直接返回 null */
export function parseSnapshot(raw: unknown): TimerSnapshot | null {
  if (!isRecord(raw)) return null

  const status = raw.status
  if (typeof status !== 'string' || !isRecoverableStatus(status as RecoverableStatus)) return null
  const phase = raw.phase
  if (phase !== 'focus' && phase !== 'break') return null
  if (phaseOfStatus(status as RecoverableStatus) !== phase) return null
  if (!isOptionalString(raw.taskId) || !isOptionalString(raw.taskTitle) || !isOptionalString(raw.roundId)) {
    return null
  }
  if (!isFiniteNumber(raw.plannedDurationMs) || raw.plannedDurationMs <= 0) return null
  if (!isFiniteNumber(raw.startedAt) || raw.startedAt <= 0) return null
  if (!isFiniteNumber(raw.remainingMs) || raw.remainingMs < 0) return null
  if (!isFiniteNumber(raw.accumulatedPauseMs) || raw.accumulatedPauseMs < 0) return null
  if (!isFiniteNumber(raw.updatedAt) || raw.updatedAt <= 0) return null

  const running = status === 'focus' || status === 'break'
  if (running) {
    if (!isFiniteNumber(raw.deadline) || raw.deadline <= 0) return null
    if (raw.pausedAt !== null) return null
  } else {
    if (raw.deadline !== null) return null
    if (!isFiniteNumber(raw.pausedAt) || raw.pausedAt <= 0) return null
  }

  return {
    status: status as RecoverableStatus,
    phase,
    taskId: raw.taskId,
    taskTitle: raw.taskTitle,
    roundId: raw.roundId,
    plannedDurationMs: raw.plannedDurationMs,
    startedAt: raw.startedAt,
    deadline: running ? (raw.deadline as number) : null,
    remainingMs: raw.remainingMs,
    pausedAt: running ? null : (raw.pausedAt as number),
    accumulatedPauseMs: raw.accumulatedPauseMs,
    updatedAt: raw.updatedAt,
  }
}

export type RecoveryPrompt = 'continue-or-discard' | 'continue-or-interrupt'

export interface RecoveryPlanActive {
  kind: 'active'
  snapshot: TimerSnapshot
  phase: TimerPhase
  remainingMs: number
  prompt: 'continue-or-discard'
}

export interface RecoveryPlanExpired {
  kind: 'expired'
  snapshot: TimerSnapshot
  phase: TimerPhase
  prompt: 'continue-or-interrupt'
}

export interface RecoveryPlanNone {
  kind: 'none'
  reason: 'missing' | 'invalid'
}

export type RecoveryPlan = RecoveryPlanActive | RecoveryPlanExpired | RecoveryPlanNone

function remainingAt(snapshot: TimerSnapshot, now: number): number {
  if (snapshot.status === 'focus' || snapshot.status === 'break') {
    return Math.max(0, (snapshot.deadline ?? now) - now)
  }
  return Math.max(0, snapshot.remainingMs)
}

/**
 * 启动时读取快照后的纯决策：
 * - active：还在进行中，询问继续/放弃
 * - expired：已经超过截止时间，询问继续/放弃并记为中断
 */
export function planRecovery(raw: unknown, now: number): RecoveryPlan {
  if (raw === null || raw === undefined) return { kind: 'none', reason: 'missing' }
  const snapshot = parseSnapshot(raw)
  if (!snapshot) return { kind: 'none', reason: 'invalid' }

  const remainingMs = remainingAt(snapshot, now)
  if (remainingMs <= 0) {
    return { kind: 'expired', snapshot, phase: snapshot.phase, prompt: 'continue-or-interrupt' }
  }
  return { kind: 'active', snapshot, phase: snapshot.phase, remainingMs, prompt: 'continue-or-discard' }
}

export type RecoveryDecision = 'continue' | 'discard'

export type RecoveryOutcome =
  | { action: 'none'; session: null }
  | { action: 'restore'; restore: RestorePayload; session: null }
  | { action: 'completed'; session: Session | null }
  | { action: 'discarded'; session: Session | null }

function buildRestorePayload(
  snapshot: TimerSnapshot,
  remainingMs: number,
  now: number,
): RestorePayload {
  const running = snapshot.status === 'focus' || snapshot.status === 'break'
  return {
    status: snapshot.status,
    phase: snapshot.phase,
    taskId: snapshot.taskId,
    taskTitle: snapshot.taskTitle,
    roundId: snapshot.roundId,
    plannedDurationMs: snapshot.plannedDurationMs,
    startedAt: snapshot.startedAt,
    // 运行中按“现在还能专注多久”重新锚定 deadline，避免恢复提示耗时被算进去
    deadline: running ? now + remainingMs : null,
    remainingMs,
    pausedAt: running ? null : (snapshot.pausedAt ?? now),
    accumulatedPauseMs: snapshot.accumulatedPauseMs,
  }
}

function buildRecoveredSession(
  snapshot: TimerSnapshot,
  status: Session['status'],
  actualDurationMs: number,
  endAt: number,
  interruptReason: string | null,
): Session | null {
  if (snapshot.phase !== 'focus') return null

  return buildSession({
    roundId: snapshot.roundId,
    taskId: snapshot.taskId,
    taskTitle: snapshot.taskTitle,
    startAt: snapshot.startedAt,
    endAt,
    plannedDurationMs: snapshot.plannedDurationMs,
    actualDurationMs,
    status,
    interruptReason,
  })
}

export function applyRecovery(
  plan: RecoveryPlan,
  decision: RecoveryDecision,
  now: number,
): RecoveryOutcome {
  if (plan.kind === 'none') return { action: 'none', session: null }

  // 用户在提示上停留的时间也要算进去，按点击这一刻重新看剩余时间
  const remainingMs = remainingAt(plan.snapshot, now)

  if (plan.kind === 'active' && remainingMs > 0) {
    if (decision === 'continue') {
      return {
        action: 'restore',
        restore: buildRestorePayload(plan.snapshot, remainingMs, now),
        session: null,
      }
    }

    const actualDurationMs = Math.max(0, plan.snapshot.plannedDurationMs - remainingMs)
    return {
      action: 'discarded',
      session: buildRecoveredSession(plan.snapshot, 'interrupted', actualDurationMs, now, 'restart-discarded'),
    }
  }

  // expired：这一轮其实已经跑满，继续 = 记为完成；放弃 = 记为中断
  const expiredEndAt = plan.snapshot.deadline ?? now
  if (decision === 'continue') {
    return {
      action: 'completed',
      session: buildRecoveredSession(
        plan.snapshot,
        'completed',
        plan.snapshot.plannedDurationMs,
        expiredEndAt,
        null,
      ),
    }
  }

  return {
    action: 'discarded',
    session: buildRecoveredSession(
      plan.snapshot,
      'interrupted',
      plan.snapshot.plannedDurationMs,
      expiredEndAt,
      'expired-discarded',
    ),
  }
}
