import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { Ref } from 'vue'
import type { NotificationType } from './useTimer'

/**
 * 岛的悬停检测与鼠标穿透（模块级单例，仅 main 窗口使用）。
 *
 * 穿透状态下 webview 收不到 mousemove，只能轮询系统光标位置来判断悬停。
 * 停靠模式的展开/收起复用这一次轮询结果，避免两套轮询同时跑。
 */

// 没悬停时可以放慢到 400ms，悬停后回到 200ms；每次调用结束再排下一次，避免并发堆叠。
const HOVER_POLL_IDLE_MS = 400
const HOVER_POLL_ACTIVE_MS = 200

export interface IslandHoverOptions {
  notificationType: Ref<NotificationType>
  /** 拖拽中暂停轮询（穿透与悬停判定都无意义） */
  isDragging: () => boolean
  /** 悬停状态变化：收起状态下碰到细边要滑回，离开后要重新计闲置 */
  onOverChange: (over: boolean) => void
  /** 每次轮询结果都回调（dock 展开收起依赖逐次喂入） */
  onPollResult: (over: boolean) => void
}

const hoverActive = ref(false)
let hoverTimer: ReturnType<typeof setTimeout> | null = null

export { hoverActive }

export function useIslandHover(options: IslandHoverOptions) {
  const { notificationType, isDragging, onOverChange, onPollResult } = options

  // 通知横幅可见，或鼠标正悬停在岛上时，关闭鼠标穿透以便接收点击。
  function syncClickThrough() {
    const interactive = notificationType.value !== null || hoverActive.value
    invoke('set_click_through', { ignore: !interactive })
  }

  function scheduleHoverPoll() {
    if (hoverTimer !== null) window.clearTimeout(hoverTimer)
    const delay = hoverActive.value ? HOVER_POLL_ACTIVE_MS : HOVER_POLL_IDLE_MS
    hoverTimer = window.setTimeout(runHoverPoll, delay)
  }

  async function runHoverPoll() {
    hoverTimer = null
    if (notificationType.value === null && !isDragging()) {
      try {
        const over = await invoke<boolean>('is_mouse_over_window', { pad: 2 })
        onPollResult(over)
        if (over !== hoverActive.value) {
          hoverActive.value = over
          syncClickThrough()
          onOverChange(over)
        }
      } catch {
        // 命令不可用时忽略
      }
    }
    scheduleHoverPoll()
  }

  function startHoverPolling() {
    if (hoverTimer !== null) return
    void runHoverPoll()
  }

  function pauseHoverPolling() {
    if (hoverTimer !== null) {
      window.clearTimeout(hoverTimer)
      hoverTimer = null
    }
  }

  /** 藏进托盘等场景：复位残留的悬停态回穿透 */
  function resetHover() {
    if (hoverActive.value) {
      hoverActive.value = false
      syncClickThrough()
    }
  }

  return {
    hoverActive,
    syncClickThrough,
    startHoverPolling,
    pauseHoverPolling,
    resetHover,
  }
}
