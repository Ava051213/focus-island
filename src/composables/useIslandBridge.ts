import { ref, watch } from 'vue'
import { emit, listen } from '@tauri-apps/api/event'
import { useSettings } from './useSettings'
import { useIslandState } from './useIslandState'
import { useTimer, type NotificationType } from './useTimer'
import { notifyTrayHidden } from './useSystemNotify'
import type { TimerStatePayload } from './useTimerBridge'

// 模块级单例：bridge 可能被多处调用（Island.vue、泡泡队列），
// 横幅类型必须全员共享，否则通知互斥会读到各自的 null。
const notificationType = ref<NotificationType>(null)
const panelMotionState = ref<'idle' | 'opening' | 'closing'>('idle')

export function useIslandBridge() {
  const { state, setState } = useIslandState()
  const { settings } = useSettings()
  const timer = useTimer()

  let unlistenTimer: (() => void) | null = null
  let unlistenPanelMotion: (() => void) | null = null
  let unlistenNotification: (() => void) | null = null
  let unlistenTrayHint: (() => void) | null = null
  let trayHintSent = false
  let panelMotionTimer: ReturnType<typeof setTimeout> | null = null
  let countdownTimer: ReturnType<typeof setInterval> | null = null
  let countdownEndAt = 0

  // 进闲置时让泡泡 overlay 喊一句（闲置喊话的视觉在 overlay 窗口渲染）
  watch(state, (s, prev) => {
    if (s === 'alert' && prev !== 'alert') {
      void emit('island-bubble', { kind: 'idle' }).catch(() => {})
    }
  })

  function playNotificationSound() {
    if (!settings.value.notifications.sound) return
    try {
      const ctx = new AudioContext()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.setValueAtTime(880, ctx.currentTime)
      osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.08)
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.16)
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.35)
    } catch {
      // Audio not available
    }
  }

  function onNotifConfirm() {
    notificationType.value = null
    emit('notification-action', 'confirm')
  }

  function onNotifExtend() {
    notificationType.value = null
    emit('notification-action', 'extend')
  }

  function onNotifDismiss() {
    notificationType.value = null
    emit('notification-action', 'dismiss')
  }

  // 胶囊上的暂停/跳过按钮只发指令，真正的计时逻辑在 panel 窗口。
  function onCapsuleToggle() {
    emit('timer-command', 'toggle').catch(() => {})
  }

  function onCapsuleSkip() {
    emit('timer-command', 'skip').catch(() => {})
  }

  function runPanelMotion(phase: 'open' | 'close') {
    if (panelMotionTimer) {
      window.clearTimeout(panelMotionTimer)
    }
    panelMotionState.value = phase === 'open' ? 'opening' : 'closing'
    panelMotionTimer = window.setTimeout(() => {
      panelMotionState.value = 'idle'
      panelMotionTimer = null
    }, phase === 'open' ? 280 : 240)
  }

  function stopLocalCountdown() {
    if (countdownTimer !== null) {
      window.clearInterval(countdownTimer)
      countdownTimer = null
    }
  }

  function syncRemainingFromEndAt() {
    if (countdownEndAt <= 0) return
    const msLeft = countdownEndAt - Date.now()
    timer.remaining.value = Math.max(0, Math.ceil(msLeft / 1000))
  }

  function startLocalCountdown(endAt: number) {
    countdownEndAt = endAt
    syncRemainingFromEndAt()
    if (countdownTimer !== null) return
    countdownTimer = window.setInterval(syncRemainingFromEndAt, 1000)
  }

  async function start() {
    unlistenTimer = await listen<TimerStatePayload>(
      'timer-state-update',
      ({ payload }) => {
        timer.totalDuration.value = payload.totalDuration
        timer.running.value = payload.running
        timer.activeTaskId.value = payload.activeTaskId
        timer.activeTaskTitle.value = payload.activeTaskTitle ?? null
        if (payload.phase !== timer.phase.value) {
          timer.phase.value = payload.phase
        }
        if (payload.running) {
          startLocalCountdown(payload.syncedAt + payload.remaining * 1000)
        } else {
          stopLocalCountdown()
          countdownEndAt = 0
          timer.remaining.value = payload.remaining
        }

        if (payload.running && payload.phase === 'focus') {
          setState('focus')
        } else if (payload.running && payload.phase === 'break') {
          setState('break')
        } else if (
          !payload.running
          && !payload.activeTaskId
          && state.value !== 'idle'
          && state.value !== 'alert'
        ) {
          setState('idle')
        }
      },
    )

    // 拉取 panel 当前计时快照，避免窗口晚启动时错过状态。
    emit('timer-state-request').catch(() => {})

    unlistenPanelMotion = await listen<string>('island-panel-motion', ({ payload }) => {
      if (payload === 'open' || payload === 'close') {
        runPanelMotion(payload)
      }
    })

    unlistenNotification = await listen<NotificationType>('notification-show', ({ payload }) => {
      notificationType.value = payload
      if (payload) playNotificationSound()
    })

    // 第一次隐藏到托盘时提醒一次，避免用户以为应用退出了
    unlistenTrayHint = await listen('island-hidden-to-tray', () => {
      if (trayHintSent) return
      trayHintSent = true
      void notifyTrayHidden()
    })
  }

  function stop() {
    unlistenTimer?.()
    unlistenPanelMotion?.()
    unlistenNotification?.()
    unlistenTrayHint?.()
    unlistenTimer = null
    unlistenPanelMotion = null
    unlistenNotification = null
    unlistenTrayHint = null
    stopLocalCountdown()
    countdownEndAt = 0
    if (panelMotionTimer) {
      window.clearTimeout(panelMotionTimer)
      panelMotionTimer = null
    }
  }

  return {
    notificationType,
    panelMotionState,
    onNotifConfirm,
    onNotifExtend,
    onNotifDismiss,
    onCapsuleToggle,
    onCapsuleSkip,
    start,
    stop,
  }
}
