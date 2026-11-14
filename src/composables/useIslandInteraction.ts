import { watch, type Ref } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useSettings } from './useSettings'
import { useDockMode } from './useDockMode'
import { useIslandHover } from './useIslandHover'
import { useIslandPeek } from './useIslandPeek'
import { useIslandDrag, isDragging, isPhysicsActive } from './useIslandDrag'
import { useIslandSizing } from './useIslandSizing'
import type { NotificationType } from './useTimer'

/**
 * 岛窗口交互的组装根：把悬停/收起/拖拽/尺寸四个模块接在一起，
 * 对外保持原有接口（Island.vue 无感知）。
 *
 * 各模块职责：
 * - useIslandGeometry 共享几何缓存与贴边摆位
 * - useIslandHover 悬停轮询与鼠标穿透
 * - useIslandPeek 闲置收起状态机
 * - useIslandDrag 拖拽 + 磁性吸附 + 松手落体物理
 * - useIslandSizing 窗口尺寸协调
 */

interface IslandInteractionOptions {
  notificationType: Ref<NotificationType>
}

let unlistenVisibility: UnlistenFn | null = null
let visibilityInstalled = false

export function useIslandInteraction(options: IslandInteractionOptions) {
  const { settingsReady } = useSettings()
  const { updatePointerOver } = useDockMode()

  const hover = useIslandHover({
    notificationType: options.notificationType,
    isDragging,
    onOverChange: (over) => {
      // 收起状态下碰到露出的细边就滑回来；离开后重新计闲置
      if (over) void peek.unretractIsland()
      else peek.schedulePeek()
    },
    onPollResult: (over) => {
      // dock 模式的展开/收起复用同一次轮询结果
      updatePointerOver(over)
    },
  })

  const peek = useIslandPeek({
    notificationType: options.notificationType,
    isDragging,
    isPhysicsActive,
  })

  const drag = useIslandDrag({ notificationType: options.notificationType })
  const sizing = useIslandSizing({ notificationType: options.notificationType })

  // 灵动岛藏进托盘后悬停判定没有意义：停掉轮询，复位悬停态，
  // 取消收起计时与下落物理；重新显示时恢复轮询并重新计闲置。
  async function onIslandVisibility(visible: boolean) {
    if (visible) {
      hover.startHoverPolling()
      peek.schedulePeek()
      return
    }
    hover.pauseHoverPolling()
    peek.cancelPeekTimer()
    drag.cancelPhysics()
    hover.resetHover()
    updatePointerOver(false)
  }

  async function installVisibilityWatch() {
    if (visibilityInstalled) return
    visibilityInstalled = true
    unlistenVisibility = await listen<boolean>('island-visibility-changed', ({ payload }) => {
      void onIslandVisibility(Boolean(payload))
    })
  }

  function start() {
    hover.syncClickThrough()
    hover.startHoverPolling()
    void sizing.applyWindowSize()
    void installVisibilityWatch()
    peek.schedulePeek()
  }

  function stop() {
    hover.pauseHoverPolling()
    peek.cancelPeekTimer()
    drag.cancelPhysics()
    unlistenVisibility?.()
    unlistenVisibility = null
    visibilityInstalled = false
  }

  // 设置加载完成后重新计闲置（摆位由 sizing 负责）
  watch(settingsReady, (ready) => {
    if (ready) peek.schedulePeek()
  })

  return {
    hoverActive: hover.hoverActive,
    dragging: drag.dragging,
    physicsImpact: drag.physicsImpact,
    onIslandClick: drag.onIslandClick,
    onCapsulePointerDown: drag.onCapsulePointerDown,
    onCapsulePointerMove: drag.onCapsulePointerMove,
    onCapsulePointerUp: drag.onCapsulePointerUp,
    syncClickThrough: hover.syncClickThrough,
    applyWindowSize: sizing.applyWindowSize,
    start,
    stop,
  }
}
