/**
 * useTimerBridge — panel 窗口专用
 * 计时器逻辑在此运行，关键状态变化时广播状态到灵动岛窗口，
 * 并把每轮结果写进 Session 账本与进行中快照。
 */
import { emit, listen } from '@tauri-apps/api/event'
import { ref, watch } from 'vue'
import { useTimer, type TimerPhase, type NotificationType } from './useTimer'
import { useMemos } from './useMemos'
import { useAchievements } from './useAchievements'
import { useSettings } from './useSettings'
import { useAiButler } from './useAiButler'
import { useSessions } from './useSessions'
import { useTimerSnapshot } from './useTimerSnapshot'
import { notifyPhaseEnd } from './useSystemNotify'
import type { PhaseEffect } from '../timer/machine'
import { buildSession } from '../timer/sessions'
import {
  applyRecovery,
  planRecovery,
  type RecoveryDecision,
  type RecoveryPlan,
} from '../timer/snapshot'

/**
 * 注意：activeTaskId / activeTaskTitle 沿用旧字段名，
 * 实际含义已经是「当前专注的对象」——它现在指向一条备忘，不再是任务。
 */
export interface TimerStatePayload {
  phase: TimerPhase
  remaining: number
  totalDuration: number
  running: boolean
  activeTaskId: string | null
  activeTaskTitle: string | null
  activeSubtaskId: string | null
  activeSubtaskTitle: string | null
  syncedAt: number
}

const recoveryPlan = ref<RecoveryPlan>({ kind: 'none', reason: 'missing' })

let bridgeStarted = false

export function useTimerBridge() {
  const timer = useTimer()
  const { incrementPomodoro } = useMemos()
  const { recordPomodoro: recordAchievementPomodoro, recordEarlyBird, recordNightOwl } = useAchievements()
  const { settings } = useSettings()
  const { recordRound } = useAiButler()
  const sessions = useSessions()
  const snapshot = useTimerSnapshot()
  let lastPayloadKey = ''

  function buildPayload() {
    return {
      phase: timer.phase.value,
      remaining: timer.remaining.value,
      totalDuration: timer.totalDuration.value,
      running: timer.running.value,
      activeTaskId: timer.activeTaskId.value,
      activeTaskTitle: timer.activeTaskTitle.value,
      activeSubtaskId: timer.activeSubtaskId.value,
      activeSubtaskTitle: timer.activeSubtaskTitle.value,
    }
  }

  function emitTimerState(force = false) {
    const payloadBase = buildPayload()
    const payloadKey = JSON.stringify(payloadBase)
    if (!force && payloadKey === lastPayloadKey) return
    lastPayloadKey = payloadKey
    const payload: TimerStatePayload = { ...payloadBase, syncedAt: Date.now() }
    emit('timer-state-update', payload)
  }

  function emitNotification(type: NotificationType) {
    emit('notification-show', type)
  }

  function saveSnapshot() {
    snapshot.save(timer.getSnapshot())
  }

  function recordCompletedRound(session: ReturnType<typeof buildSession>, startedAt: number | null) {
    if (session.status !== 'completed') return
    if (session.taskId) incrementPomodoro(session.taskId)
    recordAchievementPomodoro()
    recordRound({
      memoId: session.taskId,
      outcome: 'done',
      minutes: Math.round(session.actualDuration / 60),
    })
    const startHour = startedAt === null ? null : new Date(startedAt).getHours()
    if (startHour !== null) {
      if (startHour < 6) recordEarlyBird()
      else if (startHour >= 23) recordNightOwl()
    }
  }

  /** 完成或跳过一个专注阶段时，只写一条 Session */
  function handlePhaseEffect(effect: PhaseEffect) {
    if (effect.phase !== 'focus') return

    const actualDurationMs = effect.type === 'phase-completed'
      ? effect.plannedDurationMs
      : Math.max(0, effect.plannedDurationMs - effect.remainingMs)
    const now = Date.now()
    const session = buildSession({
      roundId: effect.roundId,
      taskId: effect.taskId,
      taskTitle: effect.taskTitle,
      startAt: effect.startedAt ?? now,
      endAt: now,
      plannedDurationMs: effect.plannedDurationMs,
      actualDurationMs,
      status: effect.type === 'phase-completed' ? 'completed' : 'skipped',
    })

    if (!sessions.append(session)) return

    if (session.status === 'completed') {
      recordCompletedRound(session, effect.startedAt)
    } else {
      recordRound({
        memoId: session.taskId,
        outcome: 'skipped',
        minutes: Math.round(session.actualDuration / 60),
      })
    }
  }

  async function initRecovery() {
    await snapshot.ensureLoaded()
    recoveryPlan.value = planRecovery(snapshot.snapshot.value, Date.now())
  }

  function resolveRecovery(decision: RecoveryDecision) {
    const plan = recoveryPlan.value
    if (plan.kind === 'none') return
    recoveryPlan.value = { kind: 'none', reason: 'missing' }

    const outcome = applyRecovery(plan, decision, Date.now())
    if (outcome.session) {
      if (sessions.append(outcome.session)) {
        if (outcome.session.status === 'completed') {
          recordCompletedRound(outcome.session, outcome.session.startAt)
        } else {
          recordRound({
            memoId: outcome.session.taskId,
            outcome: 'abandoned',
            minutes: Math.round(outcome.session.actualDuration / 60),
          })
        }
      }
    }

    if (outcome.action === 'restore') {
      timer.restore(outcome.restore)
      return
    }

    snapshot.clear()
    if (timer.status.value !== 'idle') timer.dismissNotification()
  }

  function startBridge() {
    if (bridgeStarted) return
    bridgeStarted = true

    timer.onPhaseEventCallback(handlePhaseEffect)

    // Broadcast notification state to island when pendingNotification changes
    watch(
      () => timer.pendingNotification.value,
      (notif) => {
        emitNotification(notif)
        // Also emit timer state so island gets the stopped state
        emitTimerState(true)
        // 复用现有阶段结束时机发系统通知，不新增计时触发点
        if (notif) void notifyPhaseEnd(notif, timer.activeTaskTitle.value)
      },
    )

    // Listen for notification actions from the island window
    listen<string>('notification-action', ({ payload }) => {
      const pending = timer.pendingNotification.value
      const memoId = timer.activeTaskId.value
      if (payload === 'confirm') {
        timer.confirmNotification()
      } else if (payload === 'extend') {
        timer.extendNotification()
        if (pending === 'focus-done') {
          recordRound({ memoId, outcome: 'extended', minutes: settings.value.focusDuration })
        }
      } else if (payload === 'dismiss') {
        timer.dismissNotification()
        if (pending === 'focus-done') {
          recordRound({ memoId, outcome: 'dismissed', minutes: settings.value.focusDuration })
        }
      }
    }).catch(() => {})

    // 灵动岛悬停按钮发来的指令：暂停/继续、跳过当前阶段
    listen<string>('timer-command', ({ payload }) => {
      if (timer.pendingNotification.value) return
      if (payload === 'toggle') {
        if (timer.running.value) {
          timer.pause()
        } else if (timer.activeTaskId.value) {
          timer.resume()
        }
      } else if (payload === 'skip') {
        if (timer.phase.value === 'focus') {
          timer.skipToBreak()
        } else {
          timer.skipBreak()
        }
      }
    }).catch(() => {})

    // 即时同步关键状态（开始/暂停/跳过/任务切换/阶段切换）
    watch(
      () => [
        timer.phase.value,
        timer.running.value,
        timer.totalDuration.value,
        timer.activeTaskId.value,
        timer.activeTaskTitle.value,
      ],
      () => emitTimerState(),
      { immediate: true },
    )

    watch(
      () => timer.activeTaskId.value,
      (targetId) => {
        // 专注对象就是备忘本身，开跑即视为「最近在动它」
        if (targetId) {
          const memo = useMemos().memos.value.find(m => m.id === targetId)
          if (memo) memo.updatedAt = Date.now()
        }
      },
    )

    // 状态一变就落快照；运行中每 30 秒刷新一次 updatedAt
    watch(() => timer.status.value, saveSnapshot)
    setInterval(() => {
      if (timer.running.value) saveSnapshot()
    }, 30_000)

    // 灵动岛窗口重启/晚启动时，允许主动请求一次当前快照。
    listen('timer-state-request', () => {
      emitTimerState(true)
      // Also resend notification state if pending
      if (timer.pendingNotification.value) {
        emitNotification(timer.pendingNotification.value)
      }
    }).catch(() => {})

    void initRecovery()
  }

  /** 放弃时先记录本轮已专注多久，再让计时器复位 */
  function abandonAndRecord() {
    const info = timer.getRoundInfo()
    timer.abandon()

    if (info.phase !== 'focus' || !info.roundId) return
    if (info.status !== 'focus' && info.status !== 'focusPaused') return

    const now = Date.now()
    const session = buildSession({
      roundId: info.roundId,
      taskId: info.taskId,
      taskTitle: info.taskTitle,
      startAt: info.startedAt ?? now,
      endAt: now,
      plannedDurationMs: info.plannedDurationMs,
      actualDurationMs: info.elapsedMs,
      status: 'interrupted',
      interruptReason: 'user',
    })
    if (!sessions.append(session)) return
    recordRound({
      memoId: session.taskId,
      outcome: 'abandoned',
      minutes: Math.round(session.actualDuration / 60),
    })
  }

  return {
    ...timer,
    abandon: abandonAndRecord,
    startBridge,
    recoveryPlan,
    resolveRecovery,
  }
}
