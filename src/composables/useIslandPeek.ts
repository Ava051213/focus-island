import { ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { Ref } from 'vue'
import { useSettings } from './useSettings'
import { useDockMode } from './useDockMode'
import { hoverActive } from './useIslandHover'
import { placeFromSettings, refreshIslandGeometry } from './useIslandGeometry'
import type { NotificationType } from './useTimer'

/**
 * 闲置收起 peek（模块级单例，仅 main 窗口使用，仅常驻模式）。
 *
 * 闲置几分钟沿所在边滑出屏只留一条细边，鼠标碰到露出的部分就滑回；
 * 通知、面板打开、拖拽、下落物理期间强制保持滑回状态。
 * 收起位置不写持久化设置。
 */

// 闲置多久后收起（毫秒）
const PEEK_IDLE_MS = 3 * 60 * 1000

let peekWatchInstalled = false

const peekRetracted = ref(false)
let peekTimer: number | null = null

export interface IslandPeekOptions {
  notificationType: Ref<NotificationType>
  /** 这些场景强制保持滑回：拖拽中 / 下落物理中 */
  isDragging: () => boolean
  isPhysicsActive: () => boolean
}

export function useIslandPeek(options: IslandPeekOptions) {
  const { settings, settingsReady } = useSettings()
  const { panelVisible } = useDockMode()
  const { notificationType, isDragging, isPhysicsActive } = options

  function peekEnabled(): boolean {
    return settings.value.islandPeek && settings.value.islandDisplayMode === 'resident'
  }

  // 这些场景收起会挡住正事，强制保持滑回状态
  function peekForceActive(): boolean {
    return notificationType.value !== null || isDragging() || isPhysicsActive() || panelVisible.value
  }

  function cancelPeekTimer() {
    if (peekTimer !== null) {
      window.clearTimeout(peekTimer)
      peekTimer = null
    }
  }

  function schedulePeek() {
    cancelPeekTimer()
    if (!peekEnabled() || peekRetracted.value || peekForceActive() || hoverActive.value) return
    peekTimer = window.setTimeout(() => {
      peekTimer = null
      void retractIsland()
    }, PEEK_IDLE_MS)
  }

  /** 沿所在边滑出屏只留一条细边（Rust 按 work-area 定位） */
  async function retractIsland() {
    if (!peekEnabled() || peekForceActive() || hoverActive.value) return
    peekRetracted.value = true
    try {
      await invoke('peek_island', { retract: true })
    } catch {
      // 命令不可用时忽略
    }
    await refreshIslandGeometry()
  }

  /** 滑回满贴边位置；收起状态不写持久化设置 */
  async function unretractIsland() {
    if (!peekRetracted.value) return
    peekRetracted.value = false
    cancelPeekTimer()
    try {
      await invoke('peek_island', { retract: false })
    } catch {
      // 命令不可用时忽略
    }
    await refreshIslandGeometry()
  }

  // 闲置收起开关或显示方式变化：关掉就弹回，开着重新计闲置
  if (!peekWatchInstalled) {
    peekWatchInstalled = true
    watch(
      () => [settings.value.islandPeek, settings.value.islandDisplayMode] as const,
      () => {
        if (!peekEnabled()) {
          cancelPeekTimer()
          void unretractIsland()
        } else {
          schedulePeek()
        }
      },
    )
    // 面板开着时不收起、不在下落，关上面板重新计闲置
    watch(panelVisible, (v) => {
      if (v) {
        cancelPeekTimer()
        void unretractIsland()
        if (settingsReady.value) void placeFromSettings()
      } else {
        schedulePeek()
      }
    })
  }

  return {
    peekRetracted,
    peekEnabled,
    peekForceActive,
    cancelPeekTimer,
    schedulePeek,
    retractIsland,
    unretractIsland,
  }
}
