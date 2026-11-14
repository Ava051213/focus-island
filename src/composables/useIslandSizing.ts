import { watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useSettings } from './useSettings'
import { useDockMode } from './useDockMode'
import { placeFromSettings } from './useIslandGeometry'
import { isDragging, isPhysicsActive, useIslandDrag } from './useIslandDrag'
import { useIslandPeek } from './useIslandPeek'
import type { Ref } from 'vue'
import type { NotificationType } from './useTimer'

/**
 * 岛窗口的尺寸协调（仅 main 窗口使用）。
 *
 * 按通知横幅 / 停靠细条 / 普通胶囊三种形态计算窗口尺寸，
 * 尺寸变化后让 Rust 按最近的贴边参数重摆。
 */

const BASE_HEIGHT = 34

// 贴边参数的 watch 只装一次（composable 可能被多次调用）
let sizingWatchInstalled = false

export interface IslandSizingOptions {
  notificationType: Ref<NotificationType>
}

export function useIslandSizing(options: IslandSizingOptions) {
  const { settings, settingsReady } = useSettings()
  const { dockCollapsed, DOCK_STRIP_WINDOW_H } = useDockMode()
  const showStrip = dockCollapsed
  const { cancelPhysics } = useIslandDrag({ notificationType: options.notificationType })
  const { peekEnabled, peekForceActive, peekRetracted, retractIsland } = useIslandPeek({
    notificationType: options.notificationType,
    isDragging,
    isPhysicsActive,
  })
  const notificationType = options.notificationType

  // 根据通知 / 停靠 / 胶囊状态计算主窗口尺寸
  async function applyWindowSize() {
    // 通知弹出/缩放变化时若还在下落，立即停掉物理并落位
    cancelPhysics()
    const scale = settings.value.islandScale ?? 1
    if (notificationType.value !== null) {
      // 展开到胶囊 + 间隙 + 通知横幅的高度
      const width = 360 * scale
      const height = (BASE_HEIGHT + 6 + 60) * scale
      await invoke('set_island_custom_size', { width, height })
    } else if (showStrip.value) {
      // 停靠细条（横条，位置跟着岛所在的边）
      await invoke('set_island_custom_size', {
        width: 360 * scale,
        height: DOCK_STRIP_WINDOW_H * scale,
      })
    } else {
      // 普通胶囊尺寸
      await invoke('set_island_size', { scale })
    }
    await placeFromSettings()
    // 收起状态下尺寸变了：该弹回（通知/面板等强制场景）就复位，否则保持收起
    if (peekRetracted.value) {
      if (peekForceActive() || !peekEnabled()) {
        peekRetracted.value = false
      } else {
        void retractIsland()
      }
    }
  }

  // 贴边参数变化（拖拽落位、设置页重置、另一窗口同步）时重新摆位
  if (!sizingWatchInstalled) {
    sizingWatchInstalled = true
    watch(
      () => [settings.value.islandEdge, settings.value.islandEdgeRatio] as const,
      () => {
        if (isDragging() || !settingsReady.value) return
        void placeFromSettings()
      },
    )
    // 停靠状态或缩放变化时重新计算窗口尺寸
    watch([showStrip, () => settings.value.islandScale], () => {
      void applyWindowSize()
    })
    // 设置加载完成后按保存的贴边参数摆位（启动时可能先按默认居中在顶边）
    watch(settingsReady, (ready) => {
      if (ready) void applyWindowSize()
    })
  }

  return {
    applyWindowSize,
  }
}
