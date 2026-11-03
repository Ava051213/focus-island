/**
 * 计时状态机（纯逻辑）
 *
 * 只做状态与时间账本，不碰 Vue、Tauri、持久化。
 * 时间一律用毫秒时间戳，剩余时间由 deadline 推算，暂停时才冻结到 remainingMs。
 */

export type TimerPhase = 'focus' | 'break'

export type TimerStatus =
  | 'idle'
  | 'focus'
  | 'focusPaused'
  | 'break'
  | 'breakPaused'
  | 'completed'

/** 可以写进快照、可以从快照恢复的状态 */
export type RecoverableStatus = 'focus' | 'focusPaused' | 'break' | 'breakPaused'

export type TimerEvent =
  | 'START'
  | 'PAUSE'
  | 'RESUME'
  | 'SKIP'
  | 'COMPLETE'
  | 'RESET'
  | 'RESTORE'

export interface TimerState {
  status: TimerStatus
  phase: TimerPhase
  /** 当前专注对象，指向一条备忘；没有对象时为 null */
  taskId: string | null
  taskTitle: string | null
  /** 本轮唯一标识，用于避免同一轮重复写入 Session */
  roundId: string | null
  /** 本轮计划时长（毫秒） */
  plannedDurationMs: number
  /** 阶段真正开始的时刻 */
  startedAt: number | null
  /** 运行中的截止时刻；暂停或空闲时为 null */
  deadline: number | null
  /** 暂停时冻结的剩余毫秒；运行中由 deadline 推算 */
  remainingMs: number
  /** 暂停发生的时刻；未暂停为 null */
  pausedAt: number | null
  /** 本轮累计暂停时长（毫秒） */
  accumulatedPauseMs: number
}

export interface StartPayload {
  /** 默认 focus；只有从 completed 重新开始时才允许直接开休息 */
  phase?: TimerPhase
  taskId?: string | null
  taskTitle?: string | null
  plannedDurationMs: number
  roundId?: string | null
}

export interface SkipPayload {
  /** 跳过之后所处阶段的时长；focus→break 给休息时长，break→idle 给专注时长 */
  plannedDurationMs: number
}

export interface ResetPayload {
  /** 回到 idle 时界面上显示的剩余时长，通常传专注时长 */
  plannedDurationMs?: number
}

export interface RestorePayload {
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
}

export type TimerCommand =
  | { event: 'START'; now: number; payload: StartPayload }
  | { event: 'PAUSE'; now: number }
  | { event: 'RESUME'; now: number }
  | { event: 'SKIP'; now: number; payload: SkipPayload }
  | { event: 'COMPLETE'; now: number }
  | { event: 'RESET'; now: number; payload?: ResetPayload }
  | { event: 'RESTORE'; now: number; payload: RestorePayload }

export type PhaseEffectType = 'phase-completed' | 'phase-skipped'

export interface PhaseEffect {
  type: PhaseEffectType
  phase: TimerPhase
  taskId: string | null
  taskTitle: string | null
  roundId: string | null
  plannedDurationMs: number
  /** 阶段开始时刻，Session 用它做 startAt */
  startedAt: number | null
  /** 事件发生时的剩余毫秒；完成时为 0，跳过时大于 0 */
  remainingMs: number
}

export type TransitionRejection =
  | 'INVALID_TRANSITION'
  | 'MISSING_DURATION'
  | 'MISSING_ROUND_ID'
  | 'INVALID_START_PHASE'
  | 'PHASE_ALREADY_ENDED'
  | 'INVALID_RESTORE_PAYLOAD'

export type TransitionResult =
  | { ok: true; state: TimerState; effects: PhaseEffect[] }
  | { ok: false; reason: TransitionRejection }

export function isRecoverableStatus(status: TimerStatus): status is RecoverableStatus {
  return status === 'focus'
    || status === 'focusPaused'
    || status === 'break'
    || status === 'breakPaused'
}

export function isRunningStatus(status: TimerStatus): boolean {
  return status === 'focus' || status === 'break'
}

export function isPausedStatus(status: TimerStatus): boolean {
  return status === 'focusPaused' || status === 'breakPaused'
}

export function phaseOfStatus(status: RecoverableStatus): TimerPhase {
  return status === 'break' || status === 'breakPaused' ? 'break' : 'focus'
}

export function createIdleState(remainingMs: number = 0, plannedDurationMs: number = 0): TimerState {
  return {
    status: 'idle',
    phase: 'focus',
    taskId: null,
    taskTitle: null,
    roundId: null,
    plannedDurationMs,
    startedAt: null,
    deadline: null,
    remainingMs,
    pausedAt: null,
    accumulatedPauseMs: 0,
  }
}

/** 事件发生瞬间的剩余毫秒，不做展示取整 */
export function remainingBefore(state: TimerState, now: number): number {
  if (isRunningStatus(state.status) && state.deadline !== null) {
    return Math.max(0, state.deadline - now)
  }
  return Math.max(0, state.remainingMs)
}

function reject(reason: TransitionRejection): TransitionResult {
  return { ok: false, reason }
}

function succeed(state: TimerState, effects: PhaseEffect[] = []): TransitionResult {
  return { ok: true, state, effects }
}

function start(state: TimerState, command: Extract<TimerCommand, { event: 'START' }>): TransitionResult {
  const { now, payload } = command
  if (state.status !== 'idle' && state.status !== 'completed') {
    return reject('INVALID_TRANSITION')
  }
  const phase = payload.phase ?? 'focus'
  if (state.status === 'idle' && phase !== 'focus') {
    return reject('INVALID_START_PHASE')
  }
  if (!Number.isFinite(payload.plannedDurationMs) || payload.plannedDurationMs <= 0) {
    return reject('MISSING_DURATION')
  }
  if (phase === 'focus') {
    const roundId = payload.roundId?.trim()
    if (!roundId) return reject('MISSING_ROUND_ID')
  }

  const isFocus = phase === 'focus'
  const roundId = isFocus ? (payload.roundId as string) : null
  const taskId = isFocus ? (payload.taskId ?? null) : (payload.taskId ?? state.taskId)
  const taskTitle = isFocus ? (payload.taskTitle ?? null) : (payload.taskTitle ?? state.taskTitle)

  return succeed({
    status: isFocus ? 'focus' : 'break',
    phase,
    taskId,
    taskTitle,
    roundId,
    plannedDurationMs: payload.plannedDurationMs,
    startedAt: now,
    deadline: now + payload.plannedDurationMs,
    remainingMs: payload.plannedDurationMs,
    pausedAt: null,
    accumulatedPauseMs: 0,
  })
}

function pause(state: TimerState, now: number): TransitionResult {
  if (!isRunningStatus(state.status)) return reject('INVALID_TRANSITION')
  const remainingMs = remainingBefore(state, now)
  if (remainingMs <= 0) return reject('PHASE_ALREADY_ENDED')

  return succeed({
    ...state,
    status: state.status === 'focus' ? 'focusPaused' : 'breakPaused',
    deadline: null,
    remainingMs,
    pausedAt: now,
  })
}

function resume(state: TimerState, now: number): TransitionResult {
  if (!isPausedStatus(state.status)) return reject('INVALID_TRANSITION')
  if (state.remainingMs <= 0) return reject('PHASE_ALREADY_ENDED')

  const pausedFor = state.pausedAt === null ? 0 : Math.max(0, now - state.pausedAt)
  return succeed({
    ...state,
    status: state.status === 'focusPaused' ? 'focus' : 'break',
    deadline: now + state.remainingMs,
    pausedAt: null,
    accumulatedPauseMs: state.accumulatedPauseMs + pausedFor,
  })
}

function skip(
  state: TimerState,
  command: Extract<TimerCommand, { event: 'SKIP' }>,
): TransitionResult {
  if (!isRunningStatus(state.status) && !isPausedStatus(state.status)) {
    return reject('INVALID_TRANSITION')
  }
  const { now, payload } = command
  if (!Number.isFinite(payload.plannedDurationMs) || payload.plannedDurationMs <= 0) {
    return reject('MISSING_DURATION')
  }

  const skippedPhase = state.phase
  const effect: PhaseEffect = {
    type: 'phase-skipped',
    phase: skippedPhase,
    taskId: state.taskId,
    taskTitle: state.taskTitle,
    roundId: state.roundId,
    plannedDurationMs: state.plannedDurationMs,
    startedAt: state.startedAt,
    remainingMs: remainingBefore(state, now),
  }

  if (skippedPhase === 'focus') {
    return succeed({
      status: 'break',
      phase: 'break',
      taskId: state.taskId,
      taskTitle: state.taskTitle,
      roundId: null,
      plannedDurationMs: payload.plannedDurationMs,
      startedAt: now,
      deadline: now + payload.plannedDurationMs,
      remainingMs: payload.plannedDurationMs,
      pausedAt: null,
      accumulatedPauseMs: 0,
    }, [effect])
  }

  return succeed(createIdleState(payload.plannedDurationMs, payload.plannedDurationMs), [effect])
}

function complete(state: TimerState): TransitionResult {
  if (!isRunningStatus(state.status) && !isPausedStatus(state.status)) {
    return reject('INVALID_TRANSITION')
  }

  const effect: PhaseEffect = {
    type: 'phase-completed',
    phase: state.phase,
    taskId: state.taskId,
    taskTitle: state.taskTitle,
    roundId: state.roundId,
    plannedDurationMs: state.plannedDurationMs,
    startedAt: state.startedAt,
    remainingMs: 0,
  }

  return succeed({
    ...state,
    status: 'completed',
    deadline: null,
    remainingMs: 0,
    pausedAt: null,
  }, [effect])
}

function reset(state: TimerState, payload?: ResetPayload): TransitionResult {
  if (state.status === 'idle') return reject('INVALID_TRANSITION')
  const remainingMs = Math.max(0, payload?.plannedDurationMs ?? 0)
  return succeed(createIdleState(remainingMs, remainingMs))
}

function restore(
  state: TimerState,
  command: Extract<TimerCommand, { event: 'RESTORE' }>,
): TransitionResult {
  if (state.status !== 'idle') return reject('INVALID_TRANSITION')
  const { now, payload } = command

  if (phaseOfStatus(payload.status) !== payload.phase) {
    return reject('INVALID_RESTORE_PAYLOAD')
  }
  if (payload.plannedDurationMs <= 0 || payload.startedAt <= 0) {
    return reject('INVALID_RESTORE_PAYLOAD')
  }
  if (payload.status === 'focus' || payload.status === 'focusPaused') {
    if (!payload.roundId) return reject('INVALID_RESTORE_PAYLOAD')
  }
  if (isRunningStatus(payload.status)) {
    if (payload.deadline === null || payload.deadline <= now) {
      return reject('INVALID_RESTORE_PAYLOAD')
    }
    if (payload.pausedAt !== null) return reject('INVALID_RESTORE_PAYLOAD')
  } else {
    if (payload.remainingMs <= 0) return reject('INVALID_RESTORE_PAYLOAD')
    if (payload.deadline !== null) return reject('INVALID_RESTORE_PAYLOAD')
    if (payload.pausedAt === null || payload.pausedAt <= 0) {
      return reject('INVALID_RESTORE_PAYLOAD')
    }
  }

  return succeed({
    status: payload.status,
    phase: payload.phase,
    taskId: payload.taskId,
    taskTitle: payload.taskTitle,
    roundId: payload.roundId,
    plannedDurationMs: payload.plannedDurationMs,
    startedAt: payload.startedAt,
    deadline: payload.deadline,
    remainingMs: payload.remainingMs,
    pausedAt: payload.pausedAt,
    accumulatedPauseMs: Math.max(0, payload.accumulatedPauseMs),
  })
}

export function transition(state: TimerState, command: TimerCommand): TransitionResult {
  switch (command.event) {
    case 'START':
      return start(state, command)
    case 'PAUSE':
      return pause(state, command.now)
    case 'RESUME':
      return resume(state, command.now)
    case 'SKIP':
      return skip(state, command)
    case 'COMPLETE':
      return complete(state)
    case 'RESET':
      return reset(state, command.payload)
    case 'RESTORE':
      return restore(state, command)
  }
}
