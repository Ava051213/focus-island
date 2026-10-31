/**
 * useTimerBridge — panel 窗口专用
 * 计时器逻辑在此运行，关键状态变化时广播状态到灵动岛窗口
 */
import { emit, listen } from '@tauri-apps/api/event'
import { watch } from 'vue'
import { useTimer, type TimerPhase, type NotificationType } from './useTimer'
import { useMemos } from './useMemos'
import { useDailyStats } from './useDailyStats'
import { useAchievements } from './useAchievements'
import { useSettings } from './useSettings'

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

let bridgeStarted = false

export function useTimerBridge() {
  const timer = useTimer()
  const { incrementPomodoro } = useMemos()
  const { recordPomodoro } = useDailyStats()
  const { recordPomodoro: recordAchievementPomodoro, recordEarlyBird, recordNightOwl } = useAchievements()
  const { settings } = useSettings()
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

  function startBridge() {
    if (bridgeStarted) return
    bridgeStarted = true

    timer.onPhaseDoneCallback((phase, targetId) => {
      if (phase === 'focus' && targetId) {
        incrementPomodoro(targetId)
        const focusMinutes = settings.value.focusDuration
        recordPomodoro(focusMinutes)
        recordAchievementPomodoro()

        const startHour = timer.focusStartedAt.value === null
          ? null
          : new Date(timer.focusStartedAt.value).getHours()
        if (startHour !== null) {
          if (startHour < 6) {
            recordEarlyBird()
          } else if (startHour >= 23) {
            recordNightOwl()
          }
        }
      }
    })

    // Broadcast notification state to island when pendingNotification changes
    watch(
      () => timer.pendingNotification.value,
      (notif) => {
        emitNotification(notif)
        // Also emit timer state so island gets the stopped state
        emitTimerState(true)
      },
    )

    // Listen for notification actions from the island window
    listen<string>('notification-action', ({ payload }) => {
      if (payload === 'confirm') {
        timer.confirmNotification()
      } else if (payload === 'extend') {
        timer.extendNotification()
      } else if (payload === 'dismiss') {
        timer.dismissNotification()
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

    // 灵动岛窗口重启/晚启动时，允许主动请求一次当前快照。
    listen('timer-state-request', () => {
      emitTimerState(true)
      // Also resend notification state if pending
      if (timer.pendingNotification.value) {
        emitNotification(timer.pendingNotification.value)
      }
    }).catch(() => {})
  }

  return { ...timer, startBridge }
}
