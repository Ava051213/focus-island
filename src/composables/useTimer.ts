import { ref, computed, watch, effectScope } from 'vue'
import { useSettings } from './useSettings'
import {
  createIdleState,
  isPausedStatus,
  isRunningStatus,
  remainingBefore,
  transition,
  type PhaseEffect,
  type RestorePayload,
  type TimerCommand,
  type TimerPhase,
  type TimerState,
  type TimerStatus,
} from '../timer/machine'
import { elapsedMs, evaluateClock } from '../timer/clock'
import { createSnapshot, type TimerSnapshot } from '../timer/snapshot'

export type { TimerPhase }
export type NotificationType = 'focus-done' | 'break-done' | null

const INITIAL_SECS = 25 * 60

const status = ref<TimerStatus>('idle')
const phase = ref<TimerPhase>('focus')
const remaining = ref(INITIAL_SECS)
const totalDuration = ref(INITIAL_SECS)
const running = ref(false)
const activeTaskId = ref<string | null>(null)
const activeTaskTitle = ref<string | null>(null)
const focusStartedAt = ref<number | null>(null)
const pendingNotification = ref<NotificationType>(null)

let machineState: TimerState = createIdleState(INITIAL_SECS * 1000, INITIAL_SECS * 1000)
let intervalId: ReturnType<typeof setInterval> | null = null
let lastRemainingMs: number | null = null

function newRoundId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `round-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function syncFromMachine(now: number) {
  const state = machineState
  status.value = state.status
  phase.value = state.phase
  totalDuration.value = Math.floor(state.plannedDurationMs / 1000)
  running.value = isRunningStatus(state.status)
  activeTaskId.value = state.taskId
  activeTaskTitle.value = state.taskTitle
  focusStartedAt.value = state.phase === 'focus' && state.status !== 'idle' && state.startedAt !== null
    ? state.startedAt
    : null

  if (isRunningStatus(state.status)) {
    // 状态刚切换完，不能拿上一轮的剩余时间做回拨判断
    const evaluation = evaluateClock(state, { now, previousRemainingMs: null })
    remaining.value = evaluation.displaySeconds
    lastRemainingMs = evaluation.remainingMs
  } else {
    remaining.value = Math.floor(state.remainingMs / 1000)
    lastRemainingMs = state.remainingMs
  }
}

function stopTicking() {
  if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
  }
}

function startTicking() {
  stopTicking()
  intervalId = setInterval(tick, 1000)
}

type PhaseEventCallback = (effect: PhaseEffect) => void
const phaseEventCallbacks: PhaseEventCallback[] = []

type PhaseCallback = (phase: TimerPhase, taskId: string | null) => void
const onDoneCallbacks: PhaseCallback[] = []

function emitPhaseEffects(effects: PhaseEffect[]) {
  for (const effect of effects) {
    for (const callback of phaseEventCallbacks) callback(effect)
  }
}

function apply(command: TimerCommand): PhaseEffect[] | null {
  lastRemainingMs = null
  const result = transition(machineState, command)
  if (!result.ok) {
    console.warn(`[timer] rejected ${command.event}: ${result.reason}`)
    return null
  }
  machineState = result.state
  syncFromMachine(command.now)
  return result.effects
}

function tick() {
  if (!isRunningStatus(machineState.status)) {
    stopTicking()
    return
  }

  const now = Date.now()
  const evaluation = evaluateClock(machineState, { now, previousRemainingMs: lastRemainingMs })
  if (evaluation.clockAnomaly && evaluation.nextDeadline !== null) {
    console.warn('[timer] 系统时间回拨，按上次剩余时间重新锚定 deadline')
    machineState = {
      ...machineState,
      deadline: evaluation.nextDeadline,
      remainingMs: evaluation.remainingMs,
    }
  }
  machineState = { ...machineState, remainingMs: evaluation.remainingMs }
  lastRemainingMs = evaluation.remainingMs
  remaining.value = evaluation.displaySeconds
  if (!evaluation.shouldComplete) return

  stopTicking()
  const effects = apply({ event: 'COMPLETE', now })
  if (!effects) return
  emitPhaseEffects(effects)
  const completed = effects.find(effect => effect.type === 'phase-completed')
  if (completed) {
    pendingNotification.value = completed.phase === 'focus' ? 'focus-done' : 'break-done'
    onDoneCallbacks.forEach(callback => callback(completed.phase, completed.taskId))
  }
}

let durationWatchInstalled = false

function installDurationWatch() {
  if (durationWatchInstalled) return
  durationWatchInstalled = true
  const { settings } = useSettings()
  // Detached so the watcher outlives whichever component happened to call useTimer() first.
  effectScope(true).run(() => {
    watch(
      () => [settings.value.focusDuration, settings.value.breakDuration],
      ([newFocus, newBreak]) => {
        if (!isRunningStatus(machineState.status)) return
        const newDurationMs = (machineState.phase === 'focus' ? newFocus : newBreak) * 60 * 1000
        if (machineState.plannedDurationMs === newDurationMs || machineState.plannedDurationMs <= 0) {
          return
        }
        const ratio = Math.max(0, Math.min(1, machineState.remainingMs / machineState.plannedDurationMs))
        const now = Date.now()
        const nextRemaining = Math.round(newDurationMs * ratio)
        machineState = {
          ...machineState,
          plannedDurationMs: newDurationMs,
          remainingMs: nextRemaining,
          deadline: now + nextRemaining,
        }
        syncFromMachine(now)
      },
    )
  })
}

const progress = computed(() => {
  if (totalDuration.value <= 0) return 0
  return 1 - remaining.value / totalDuration.value
})

export function useTimer() {
  const { settings } = useSettings()
  installDurationWatch()

  const displayTime = computed(() => {
    const m = Math.floor(remaining.value / 60).toString().padStart(2, '0')
    const s = (remaining.value % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  })

  function start(taskId: string | null, taskTitle?: string) {
    const focusSecs = settings.value.focusDuration * 60
    const effects = apply({
      event: 'START',
      now: Date.now(),
      payload: {
        phase: 'focus',
        taskId,
        taskTitle: taskTitle ?? null,
        plannedDurationMs: focusSecs * 1000,
        roundId: newRoundId(),
      },
    })
    if (effects) startTicking()
  }

  function resume() {
    if (isPausedStatus(machineState.status)) {
      const effects = apply({ event: 'RESUME', now: Date.now() })
      if (effects) startTicking()
      return
    }
    // 完成后卡片上的「继续呀」：专注结束就再开一轮，休息结束就开始下一轮专注
    if (machineState.status === 'completed') {
      if (pendingNotification.value === 'focus-done') extendNotification()
      else if (pendingNotification.value === 'break-done') confirmNotification()
    }
  }

  function pause() {
    if (!isRunningStatus(machineState.status)) return
    apply({ event: 'PAUSE', now: Date.now() })
    stopTicking()
  }

  function skipToBreak() {
    if (machineState.phase !== 'focus') return
    const breakSecs = settings.value.breakDuration * 60
    const effects = apply({
      event: 'SKIP',
      now: Date.now(),
      payload: { plannedDurationMs: breakSecs * 1000 },
    })
    if (!effects) return
    emitPhaseEffects(effects)
    startTicking()
  }

  function skipBreak() {
    if (machineState.phase !== 'break') return
    const focusSecs = settings.value.focusDuration * 60
    const effects = apply({
      event: 'SKIP',
      now: Date.now(),
      payload: { plannedDurationMs: focusSecs * 1000 },
    })
    pendingNotification.value = null
    stopTicking()
    if (effects) emitPhaseEffects(effects)
  }

  /** User chose "休息" (after focus) or "继续" (after break) */
  function confirmNotification() {
    const notif = pendingNotification.value
    if (!notif) return
    pendingNotification.value = null
    const now = Date.now()

    if (notif === 'focus-done') {
      const breakSecs = settings.value.breakDuration * 60
      const effects = apply({
        event: 'START',
        now,
        payload: {
          phase: 'break',
          plannedDurationMs: breakSecs * 1000,
          taskId: machineState.taskId,
          taskTitle: machineState.taskTitle,
        },
      })
      if (effects) startTicking()
      return
    }

    const focusSecs = settings.value.focusDuration * 60
    const effects = apply({
      event: 'START',
      now,
      payload: {
        phase: 'focus',
        plannedDurationMs: focusSecs * 1000,
        roundId: newRoundId(),
        taskId: machineState.taskId,
        taskTitle: machineState.taskTitle,
      },
    })
    if (effects) startTicking()
  }

  /** User chose "继续专注" / "再休息会儿" — reset current phase countdown */
  function extendNotification() {
    const notif = pendingNotification.value
    if (!notif) return
    pendingNotification.value = null
    const now = Date.now()

    if (notif === 'focus-done') {
      const focusSecs = settings.value.focusDuration * 60
      const effects = apply({
        event: 'START',
        now,
        payload: {
          phase: 'focus',
          plannedDurationMs: focusSecs * 1000,
          roundId: newRoundId(),
          taskId: machineState.taskId,
          taskTitle: machineState.taskTitle,
        },
      })
      if (effects) startTicking()
      return
    }

    const breakSecs = settings.value.breakDuration * 60
    const effects = apply({
      event: 'START',
      now,
      payload: {
        phase: 'break',
        plannedDurationMs: breakSecs * 1000,
        taskId: machineState.taskId,
        taskTitle: machineState.taskTitle,
      },
    })
    if (effects) startTicking()
  }

  /** User chose "退出" — return to idle */
  function dismissNotification() {
    pendingNotification.value = null
    const focusSecs = settings.value.focusDuration * 60
    apply({
      event: 'RESET',
      now: Date.now(),
      payload: { plannedDurationMs: focusSecs * 1000 },
    })
    stopTicking()
  }

  function abandon() {
    pendingNotification.value = null
    const focusSecs = settings.value.focusDuration * 60
    apply({
      event: 'RESET',
      now: Date.now(),
      payload: { plannedDurationMs: focusSecs * 1000 },
    })
    stopTicking()
  }

  /** 从快照恢复；只接受进行中的状态 */
  function restore(payload: RestorePayload, now: number = Date.now()): boolean {
    const result = transition(machineState, { event: 'RESTORE', now, payload })
    if (!result.ok) {
      console.warn(`[timer] rejected RESTORE: ${result.reason}`)
      return false
    }
    machineState = result.state
    syncFromMachine(now)
    if (isRunningStatus(machineState.status)) startTicking()
    else stopTicking()
    return true
  }

  function getSnapshot(now: number = Date.now()): TimerSnapshot | null {
    return createSnapshot(machineState, now)
  }

  function getRoundInfo(now: number = Date.now()) {
    return {
      status: machineState.status,
      phase: machineState.phase,
      taskId: machineState.taskId,
      taskTitle: machineState.taskTitle,
      roundId: machineState.roundId,
      plannedDurationMs: machineState.plannedDurationMs,
      startedAt: machineState.startedAt,
      elapsedMs: elapsedMs(machineState, now),
      remainingMs: remainingBefore(machineState, now),
    }
  }

  function onPhaseDoneCallback(cb: PhaseCallback) {
    onDoneCallbacks.push(cb)
  }

  function onPhaseEventCallback(cb: PhaseEventCallback) {
    phaseEventCallbacks.push(cb)
  }

  return {
    status,
    phase,
    remaining,
    totalDuration,
    running,
    activeTaskId,
    activeTaskTitle,
    focusStartedAt,
    pendingNotification,
    progress,
    displayTime,
    start,
    resume,
    pause,
    skipToBreak,
    skipBreak,
    abandon,
    confirmNotification,
    extendNotification,
    dismissNotification,
    restore,
    getSnapshot,
    getRoundInfo,
    onPhaseDoneCallback,
    onPhaseEventCallback,
  }
}
