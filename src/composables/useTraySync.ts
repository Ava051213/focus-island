/**
 * 托盘集成（panel 窗口专用）
 *
 * 前端把计时状态推给 Rust，Rust 只负责菜单文案与 tooltip；
 * 托盘菜单动作通过 `tray-command` 回到前端，复用 useTimer 的既有动作。
 */
import { computed, watch, type Ref } from 'vue'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useTimer } from './useTimer'
import { useSettings } from './useSettings'
import { runTimerCommand, type TimerCommandTarget } from './useTimerCommands'

export interface TrayTimerTarget extends TimerCommandTarget {
  remaining: Ref<number>
  activeTaskTitle: Ref<string | null>
}

interface TrayStatePayload {
  status: string
  phase: string
  running: boolean
  remainingSeconds: number
  taskTitle: string | null
}

export function useTraySync(injected?: TrayTimerTarget) {
  const { settings } = useSettings()
  const timer = injected ?? useTimer()
  let lastPushed = ''
  let unlisten: (() => void) | null = null

  // 剩余时间按分钟推送：tooltip 不需要秒级跳动，也避免每秒一次 IPC。
  // 向上取整与 Rust 侧 tooltip 的算法一致，避免显示「24 分钟」却只剩 10 秒。
  const remainingMinutes = computed(() => Math.ceil(Math.max(0, timer.remaining.value) / 60))

  function pushTrayState(force = false) {
    if (!isTauri()) return
    const payload: TrayStatePayload = {
      status: timer.status.value,
      phase: timer.phase.value,
      running: timer.running.value,
      remainingSeconds: remainingMinutes.value * 60,
      taskTitle: timer.activeTaskTitle.value,
    }
    const key = JSON.stringify(payload)
    if (!force && key === lastPushed) return
    lastPushed = key
    invoke('update_tray_state', { state: payload }).catch(() => {})
  }

  watch(
    [
      timer.status,
      timer.phase,
      timer.running,
      timer.activeTaskTitle,
      remainingMinutes,
    ],
    () => pushTrayState(),
    { immediate: true },
  )

  // 关闭窗口行为由设置驱动 Rust：true = 隐藏到托盘，false = 直接退出
  watch(
    () => settings.value.tray.closeToTray,
    (enabled) => {
      if (!isTauri()) return
      invoke('set_close_to_tray', { enabled }).catch(() => {})
    },
    { immediate: true },
  )

  listen<string>('tray-command', ({ payload }) => {
    runTimerCommand(String(payload ?? ''), timer)
  })
    .then((un) => {
      unlisten = un
    })
    .catch(() => {})

  return {
    pushTrayState,
    stop() {
      unlisten?.()
      unlisten = null
    },
  }
}
