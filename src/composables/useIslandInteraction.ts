import { ref, watch, type Ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { availableMonitors, getCurrentWindow, PhysicalPosition } from '@tauri-apps/api/window'
import { useSettings } from './useSettings'
import { useDockMode } from './useDockMode'
import {
  edgeRatioForPosition,
  nearestEdge,
  snapToNearestEdge,
  type PlacementArea,
} from '../utils/islandPlacement'
import type { NotificationType } from './useTimer'

interface ScreenRect {
  left: number
  top: number
  width: number
  height: number
}

interface IslandInteractionOptions {
  notificationType: Ref<NotificationType>
}

const BASE_HEIGHT = 34

// 穿透状态下 webview 收不到 mousemove，只能轮询系统光标位置来判断悬停。
// 停靠模式的展开/收起也复用这一次结果，避免两套轮询同时跑。
// 没悬停时可以放慢到 400ms，悬停后回到 200ms；每次调用结束再排下一次，避免并发堆叠。
const HOVER_POLL_IDLE_MS = 400
const HOVER_POLL_ACTIVE_MS = 200

// 拖拽中的磁性吸附距离（CSS 像素），转物理像素要乘 dpr
const MAGNET_SNAP_CSS_PX = 24

// 贴边参数的 watch 只装一次（composable 可能被多次调用）
let watchInstalled = false

export function useIslandInteraction(options: IslandInteractionOptions) {
  const { settings, settingsReady } = useSettings()
  const { dockCollapsed, updatePointerOver, DOCK_STRIP_WINDOW_H } = useDockMode()
  const showStrip = dockCollapsed

  const notificationType = options.notificationType

  const islandWindow = getCurrentWindow()
  const hoverActive = ref(false)
  const dragging = ref(false)

  let hoverTimer: ReturnType<typeof setTimeout> | null = null

  let dragPointerId: number | null = null
  let dragStartScreenX = 0
  let dragStartScreenY = 0
  let dragStartWindowX = 0
  let dragStartWindowY = 0
  let dragMoved = false

  let screens: ScreenRect[] = []
  let virtualLeft = 0
  let virtualRight = 0
  let virtualTop = 0
  let virtualBottom = 0
  let windowWidth = 0
  let windowHeight = 0
  let currentWindowX = 0
  let currentWindowY = 0

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
    if (notificationType.value === null && !dragging.value) {
      try {
        const over = await invoke<boolean>('is_mouse_over_window', { pad: 2 })
        updatePointerOver(over)
        if (over !== hoverActive.value) {
          hoverActive.value = over
          syncClickThrough()
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

  // 灵动岛藏进托盘后悬停判定没有意义：停掉轮询，并把可能残留的悬停态
  // 复位回穿透；重新显示时恢复轮询。
  async function onIslandVisibility(visible: boolean) {
    if (visible) {
      startHoverPolling()
      return
    }
    pauseHoverPolling()
    if (hoverActive.value) {
      hoverActive.value = false
      syncClickThrough()
    }
    updatePointerOver(false)
  }

  let unlistenVisibility: UnlistenFn | null = null
  let visibilityInstalled = false

  async function installVisibilityWatch() {
    if (visibilityInstalled) return
    visibilityInstalled = true
    unlistenVisibility = await listen<boolean>('island-visibility-changed', ({ payload }) => {
      void onIslandVisibility(Boolean(payload))
    })
  }

  async function onIslandClick() {
    if (dragMoved) {
      dragMoved = false
      return
    }
    try {
      await invoke('toggle_panel')
    } catch {
      // 忽略
    }
  }

  /** 按窗口中心点找所在屏幕；落在缝隙里就取中心最近的一块 */
  function screenForPoint(centerX: number, centerY: number): ScreenRect | null {
    if (screens.length === 0) return null
    const hit = screens.find(
      s => centerX >= s.left && centerX <= s.left + s.width
        && centerY >= s.top && centerY <= s.top + s.height,
    )
    if (hit) return hit
    let nearest = screens[0]
    let bestDist = Number.POSITIVE_INFINITY
    for (const s of screens) {
      const d = Math.abs(s.left + s.width / 2 - centerX) + Math.abs(s.top + s.height / 2 - centerY)
      if (d < bestDist) {
        bestDist = d
        nearest = s
      }
    }
    return nearest
  }

  async function refreshIslandGeometry() {
    try {
      const list = await availableMonitors()
      screens = list.map(m => ({
        left: m.position.x,
        top: m.position.y,
        width: m.size.width,
        height: m.size.height,
      }))
      if (screens.length > 0) {
        virtualLeft = Math.min(...screens.map(s => s.left))
        virtualRight = Math.max(...screens.map(s => s.left + s.width))
        virtualTop = Math.min(...screens.map(s => s.top))
        virtualBottom = Math.max(...screens.map(s => s.top + s.height))
      }
      const size = await islandWindow.outerSize()
      const pos = await islandWindow.outerPosition()
      windowWidth = size.width
      windowHeight = size.height
      currentWindowX = pos.x
      currentWindowY = pos.y
    } catch {
      // 平台不支持时保持旧值
    }
  }

  /**
   * 按设置里的贴边参数让 Rust 摆窗口（Rust 带 work-area 感知，是位置的最终裁决）。
   * 顺手刷新本地几何缓存。
   */
  async function placeFromSettings() {
    const edge = settings.value.islandEdge
    const ratio = settings.value.islandEdgeRatio
    try {
      await invoke('place_island', { edge, ratio })
    } catch {
      // 命令不可用时忽略
    }
    await refreshIslandGeometry()
  }

  // 拖动范围放宽到整个虚拟桌面，岛可以跨到副屏
  function clampToVirtualDesktop(x: number, y: number): { x: number; y: number } {
    const maxX = virtualRight - virtualLeft - windowWidth
    const maxY = virtualBottom - virtualTop - windowHeight
    const cx = Math.round(Math.min(Math.max(x, virtualLeft), maxX > 0 ? virtualLeft + maxX : virtualLeft))
    const cy = Math.round(Math.min(Math.max(y, virtualTop), maxY > 0 ? virtualTop + maxY : virtualTop))
    return { x: cx, y: cy }
  }

  function onCapsulePointerDown(e: PointerEvent) {
    if (e.button !== 0) return
    const el = e.currentTarget as HTMLElement | null
    try {
      el?.setPointerCapture(e.pointerId)
    } catch {
      // 忽略
    }
    dragPointerId = e.pointerId
    dragStartScreenX = e.screenX
    dragStartScreenY = e.screenY
    dragStartWindowX = currentWindowX
    dragStartWindowY = currentWindowY
    dragMoved = false
  }

  function onCapsulePointerMove(e: PointerEvent) {
    if (dragPointerId !== e.pointerId) return
    const dxCss = e.screenX - dragStartScreenX
    const dyCss = e.screenY - dragStartScreenY
    // 小于阈值视为点击，避免手抖把单击变成微移
    if (!dragMoved && Math.abs(dxCss) < 4 && Math.abs(dyCss) < 4) return
    dragMoved = true
    dragging.value = true
    const dpr = window.devicePixelRatio || 1
    const moved = clampToVirtualDesktop(
      dragStartWindowX + dxCss * dpr,
      dragStartWindowY + dyCss * dpr,
    )
    let x = moved.x
    let y = moved.y
    // 磁性吸附：靠近某条边时贴上去（沿边方向还能继续滑）
    const screen = screenForPoint(x + windowWidth / 2, y + windowHeight / 2)
    if (screen) {
      const area: PlacementArea = { left: screen.left, top: screen.top, width: screen.width, height: screen.height }
      const snapped = snapToNearestEdge(area, { width: windowWidth, height: windowHeight }, x, y, MAGNET_SNAP_CSS_PX * dpr)
      if (snapped) {
        x = snapped.x
        y = snapped.y
      }
    }
    currentWindowX = x
    currentWindowY = y
    islandWindow.setPosition(new PhysicalPosition(x, y)).catch(() => {})
  }

  async function onCapsulePointerUp(e: PointerEvent) {
    if (dragPointerId !== e.pointerId) return
    const el = e.currentTarget as HTMLElement | null
    try {
      el?.releasePointerCapture(e.pointerId)
    } catch {
      // 忽略
    }
    dragPointerId = null
    if (!dragging.value) return
    dragging.value = false
    await refreshIslandGeometry()
    const screen = screenForPoint(currentWindowX + windowWidth / 2, currentWindowY + windowHeight / 2)
    if (screen) {
      const area: PlacementArea = { left: screen.left, top: screen.top, width: screen.width, height: screen.height }
      // 只贴边不悬空：松手必落在最近的一条边上
      const edge = nearestEdge(area, { width: windowWidth, height: windowHeight }, currentWindowX, currentWindowY)
      const ratio = edgeRatioForPosition(area, { width: windowWidth, height: windowHeight }, edge, currentWindowX, currentWindowY)
      settings.value.islandEdge = edge
      settings.value.islandEdgeRatio = ratio
    }
    // 设置可能没变（比如原边原比例），显式摆一次保证贴边落位
    await placeFromSettings()
  }

  // 根据通知 / 停靠 / 胶囊状态计算主窗口尺寸
  async function applyWindowSize() {
    const scale = settings.value.islandScale ?? 1
    if (notificationType.value !== null) {
      // 展开到胶囊 + 间隙 + 通知横幅的高度
      const width = 360 * scale
      const height = (BASE_HEIGHT + 6 + 60) * scale
      await invoke('set_island_custom_size', { width, height })
    } else if (showStrip.value) {
      // 停靠细条：贴顶/底是横条，贴左/右变竖条，位置都跟着岛所在的边
      const vertical = settings.value.islandEdge === 'left' || settings.value.islandEdge === 'right'
      await invoke('set_island_custom_size', {
        width: (vertical ? DOCK_STRIP_WINDOW_H : 360) * scale,
        height: (vertical ? 360 : DOCK_STRIP_WINDOW_H) * scale,
      })
    } else {
      // 普通胶囊尺寸
      await invoke('set_island_size', { scale })
    }
    await placeFromSettings()
  }

  // 贴边参数变化（拖拽落位、设置页重置、另一窗口同步）时重新摆位
  if (!watchInstalled) {
    watchInstalled = true
    watch(
      () => [settings.value.islandEdge, settings.value.islandEdgeRatio] as const,
      () => {
        if (dragging.value || !settingsReady.value) return
        void placeFromSettings()
      },
    )
  }

  function start() {
    syncClickThrough()
    startHoverPolling()
    void applyWindowSize()
    void installVisibilityWatch()
  }

  function stop() {
    pauseHoverPolling()
    unlistenVisibility?.()
    unlistenVisibility = null
    visibilityInstalled = false
  }

  // 停靠状态或缩放变化时重新计算窗口尺寸
  watch([showStrip, () => settings.value.islandScale], () => {
    void applyWindowSize()
  })

  // 设置加载完成后按保存的贴边参数摆位（启动时可能先按默认居中在顶边）
  watch(settingsReady, (ready) => {
    if (ready) void applyWindowSize()
  })

  return {
    hoverActive,
    dragging,
    onIslandClick,
    onCapsulePointerDown,
    onCapsulePointerMove,
    onCapsulePointerUp,
    syncClickThrough,
    applyWindowSize,
    start,
    stop,
  }
}
