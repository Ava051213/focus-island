import { ref, watch, type Ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { availableMonitors, getCurrentWindow, PhysicalPosition } from '@tauri-apps/api/window'
import { useSettings } from './useSettings'
import { useDockMode } from './useDockMode'
import type { NotificationType } from './useTimer'

interface ScreenRect {
  left: number
  top: number
  width: number
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
  let dragStartWindowX = 0
  let dragMoved = false

  let screens: ScreenRect[] = []
  let virtualLeft = 0
  let virtualRight = 0
  let monitorTop = 0
  let windowWidth = 0
  let currentWindowX = 0

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

  /** 按窗口中心的横坐标找屏幕；落在缝隙里就取最近的一块 */
  function screenForX(centerX: number): ScreenRect | null {
    if (screens.length === 0) return null
    const hit = screens.find(s => centerX >= s.left && centerX <= s.left + s.width)
    if (hit) return hit
    let nearest = screens[0]
    for (const s of screens) {
      const d = Math.abs(s.left + s.width / 2 - centerX)
      const best = Math.abs(nearest.left + nearest.width / 2 - centerX)
      if (d < best) nearest = s
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
      }))
      if (screens.length > 0) {
        virtualLeft = Math.min(...screens.map(s => s.left))
        virtualRight = Math.max(...screens.map(s => s.left + s.width))
      }
      const size = await islandWindow.outerSize()
      const pos = await islandWindow.outerPosition()
      windowWidth = size.width
      currentWindowX = pos.x
      const screen = screenForX(pos.x + windowWidth / 2)
      if (screen) monitorTop = screen.top
    } catch {
      // 平台不支持时保持旧值
    }
  }

  // 尺寸变化后（Rust 会按当前屏幕水平居中）按保存的比例贴回原来的位置。
  async function restoreIslandX() {
    await refreshIslandGeometry()
    const ratio = settings.value.islandXRatio
    if (ratio === null || screens.length === 0) return
    const screen = screenForX(currentWindowX + windowWidth / 2)
    if (!screen) return
    const maxX = screen.width - windowWidth
    if (maxX <= 0) return
    const x = Math.round(screen.left + ratio * maxX)
    try {
      await islandWindow.setPosition(new PhysicalPosition(x, screen.top))
      currentWindowX = x
      monitorTop = screen.top
    } catch {
      // 忽略
    }
  }

  // 拖动范围放宽到整个虚拟桌面，胶囊可以跨到副屏
  function clampIslandX(x: number) {
    const maxX = virtualRight - virtualLeft - windowWidth
    if (maxX <= 0) return virtualLeft
    return Math.round(Math.min(Math.max(x, virtualLeft), virtualLeft + maxX))
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
    dragStartWindowX = currentWindowX
    dragMoved = false
  }

  function onCapsulePointerMove(e: PointerEvent) {
    if (dragPointerId !== e.pointerId) return
    const dxCss = e.screenX - dragStartScreenX
    // 小于阈值视为点击，避免手抖把单击变成微移
    if (!dragMoved && Math.abs(dxCss) < 4) return
    dragMoved = true
    dragging.value = true
    const dpr = window.devicePixelRatio || 1
    const x = clampIslandX(dragStartWindowX + dxCss * dpr)
    // 跨到另一块屏时，纵向跟着那块屏的顶边，别停在半空
    const screen = screenForX(x + windowWidth / 2)
    if (screen) monitorTop = screen.top
    currentWindowX = x
    islandWindow.setPosition(new PhysicalPosition(x, monitorTop)).catch(() => {})
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
    const screen = screenForX(currentWindowX + windowWidth / 2)
    const maxX = screen ? screen.width - windowWidth : 0
    if (screen && maxX > 0) {
      settings.value.islandXRatio = Math.min(
        Math.max((currentWindowX - screen.left) / maxX, 0),
        1,
      )
    }
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
      // 顶边上的停靠细条
      await invoke('set_island_custom_size', {
        width: 360 * scale,
        height: DOCK_STRIP_WINDOW_H * scale,
      })
    } else {
      // 普通胶囊尺寸
      await invoke('set_island_size', { scale })
    }
    await restoreIslandX()
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

  // 设置加载完成后按保存的水平位置贴回（启动时可能先按默认居中）
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
