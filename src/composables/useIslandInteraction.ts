import { ref, watch, type Ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { availableMonitors, getCurrentWindow, PhysicalPosition } from '@tauri-apps/api/window'
import { useSettings } from './useSettings'
import { useDockMode } from './useDockMode'
import {
  edgeDistances,
  edgeRatioForPosition,
  snapToNearestEdge,
  type PlacementArea,
} from '../utils/islandPlacement'
import { FLING, PHYSICS, isRestingOnFloor, stepPhysics, type PhysicsImpact } from '../utils/islandPhysics'
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

// 闲置多久后收起（毫秒）
const PEEK_IDLE_MS = 3 * 60 * 1000

// 贴边参数的 watch 只装一次（composable 可能被多次调用）
let watchInstalled = false
let peekWatchInstalled = false

export function useIslandInteraction(options: IslandInteractionOptions) {
  const { settings, settingsReady } = useSettings()
  const { dockCollapsed, panelVisible, updatePointerOver, DOCK_STRIP_WINDOW_H } = useDockMode()
  const showStrip = dockCollapsed

  const notificationType = options.notificationType

  const islandWindow = getCurrentWindow()
  const hoverActive = ref(false)
  const dragging = ref(false)
  const peekRetracted = ref(false)
  /** 最近一次物理碰撞（带自增 id，连续同类型碰撞也能触发动画） */
  const physicsImpact = ref<{ kind: PhysicsImpact; id: number } | null>(null)
  let impactSeq = 0

  let hoverTimer: ReturnType<typeof setTimeout> | null = null
  let peekTimer: number | null = null

  // 落体物理：rAF 驱动，松手到落定之间 islandActive 为真
  let physicsRaf: number | null = null
  let physicsActive = false
  let physicsStartAt = 0
  let lastFrameAt = 0

  let dragPointerId: number | null = null
  let dragStartScreenX = 0
  let dragStartScreenY = 0
  let dragStartWindowX = 0
  let dragStartWindowY = 0
  let dragMoved = false
  // 指针位置采样，用于松手时估甩出速度
  let pointerSamples: Array<{ t: number; x: number; y: number }> = []

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
          // 收起状态下碰到露出的细边就滑回来；离开后重新计闲置
          if (over) void unretractIsland()
          else schedulePeek()
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
      schedulePeek()
      return
    }
    pauseHoverPolling()
    cancelPeekTimer()
    cancelPhysics()
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

  // ---------- 闲置收起（peek，仅常驻模式） ----------

  function peekEnabled(): boolean {
    return settings.value.islandPeek && settings.value.islandDisplayMode === 'resident'
  }

  // 这些场景收起会挡住正事，强制保持滑回状态
  function peekForceActive(): boolean {
    return notificationType.value !== null || dragging.value || physicsActive || panelVisible.value
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

  // ---------- 落体物理（松手到落定） ----------

  function cancelPhysics() {
    if (physicsRaf !== null) {
      cancelAnimationFrame(physicsRaf)
      physicsRaf = null
    }
    physicsActive = false
  }

  async function settleAfterPhysics(area: PlacementArea, win: { width: number; height: number }, x: number) {
    settings.value.islandEdge = 'bottom'
    settings.value.islandEdgeRatio = edgeRatioForPosition(area, win, 'bottom', x)
    await placeFromSettings()
    schedulePeek()
  }

  /** 松手后交给重力：带着甩出速度掉落弹跳，最后停到底边；期间随时可被抓住或打断 */
  async function startThrowPhysics(area: PlacementArea, velocity: { vx: number; vy: number }) {
    cancelPhysics()
    let bounds: [number, number, number, number] | null = null
    try {
      bounds = await invoke<[number, number, number, number] | null>('get_island_work_area')
    } catch {
      bounds = null
    }
    if (!bounds) {
      // 物理边界拿不到就退回普通贴边落位
      await placeFromSettings()
      schedulePeek()
      return
    }
    const win = { width: windowWidth, height: windowHeight }
    const pbounds = { left: bounds[0], top: bounds[1], width: bounds[2], height: bounds[3] }
    const state = { x: currentWindowX, y: currentWindowY, vx: velocity.vx, vy: velocity.vy }
    if (isRestingOnFloor(state, pbounds, win) && Math.hypot(state.vx, state.vy) < FLING.dockSpeed) {
      await settleAfterPhysics(area, win, state.x)
      return
    }
    physicsActive = true
    physicsStartAt = performance.now()
    lastFrameAt = physicsStartAt
    const tick = (now: number) => {
      physicsRaf = null
      if (!physicsActive) return
      const dt = Math.min((now - lastFrameAt) / 1000, 0.25)
      lastFrameAt = now
      const result = stepPhysics(state, pbounds, win, dt)
      if (result.impact) physicsImpact.value = { kind: result.impact, id: ++impactSeq }
      void islandWindow
        .setPosition(new PhysicalPosition(Math.round(state.x), Math.round(state.y)))
        .catch(() => {})
      if (result.settled || now - physicsStartAt > PHYSICS.maxDuration * 1000) {
        // 收敛或超时：按贴边语义精确落位，消除积分累积误差
        physicsActive = false
        state.vy = 0
        state.y = Math.max(pbounds.top, pbounds.top + pbounds.height - win.height)
        void settleAfterPhysics(area, win, state.x)
        return
      }
      physicsRaf = requestAnimationFrame(tick)
    }
    physicsRaf = requestAnimationFrame(tick)
  }

  // 拖动范围放宽到整个虚拟桌面，岛可以跨到副屏
  function clampToVirtualDesktop(x: number, y: number): { x: number; y: number } {
    const maxX = virtualRight - virtualLeft - windowWidth
    const maxY = virtualBottom - virtualTop - windowHeight
    const cx = Math.round(Math.min(Math.max(x, virtualLeft), maxX > 0 ? virtualLeft + maxX : virtualLeft))
    const cy = Math.round(Math.min(Math.max(y, virtualTop), maxY > 0 ? virtualTop + maxY : virtualTop))
    return { x: cx, y: cy }
  }

  /** 用最近的指针采样估甩出速度（物理 px/s），采样太少或停顿就返回零 */
  function estimateFlingVelocity(): { vx: number; vy: number } {
    const dpr = window.devicePixelRatio || 1
    const now = performance.now()
    const recent = pointerSamples.filter(s => now - s.t <= FLING.sampleMs)
    if (recent.length < 2) return { vx: 0, vy: 0 }
    const first = recent[0]
    const last = recent[recent.length - 1]
    const dt = (last.t - first.t) / 1000
    if (dt < 0.016) return { vx: 0, vy: 0 }
    const vx = ((last.x - first.x) / dt) * dpr
    const vy = ((last.y - first.y) / dt) * dpr
    const speed = Math.hypot(vx, vy)
    if (speed > FLING.maxSpeed) {
      return { vx: (vx / speed) * FLING.maxSpeed, vy: (vy / speed) * FLING.maxSpeed }
    }
    return { vx, vy }
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
    pointerSamples = [{ t: performance.now(), x: e.screenX, y: e.screenY }]
    // 下落途中一把抓住：取消物理；从收起状态直接拖：先滑回满贴边位置再跟手
    cancelPhysics()
    cancelPeekTimer()
    void unretractIsland()
  }

  function onCapsulePointerMove(e: PointerEvent) {
    if (dragPointerId !== e.pointerId) return
    const dxCss = e.screenX - dragStartScreenX
    const dyCss = e.screenY - dragStartScreenY
    // 小于阈值视为点击，避免手抖把单击变成微移
    if (!dragMoved && Math.abs(dxCss) < 4 && Math.abs(dyCss) < 4) return
    dragMoved = true
    dragging.value = true
    pointerSamples.push({ t: performance.now(), x: e.screenX, y: e.screenY })
    if (pointerSamples.length > 40) pointerSamples = pointerSamples.slice(-40)
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
    const win = { width: windowWidth, height: windowHeight }
    const fling = estimateFlingVelocity()
    const screen = screenForPoint(currentWindowX + windowWidth / 2, currentWindowY + windowHeight / 2)
    if (screen) {
      const area: PlacementArea = { left: screen.left, top: screen.top, width: screen.width, height: screen.height }
      // 慢速且贴近顶边：照旧吸附停靠，不演物理；甩上去的会撞顶弹回来
      const dTop = edgeDistances(area, win, currentWindowX, currentWindowY).top
      const flingSpeed = Math.hypot(fling.vx, fling.vy)
      // 系统要求减少动画：跳过物理，直接落到最近边
      const reducedMotion = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (!reducedMotion && dTop <= MAGNET_SNAP_CSS_PX * (window.devicePixelRatio || 1) && flingSpeed < FLING.dockSpeed) {
        settings.value.islandEdge = 'top'
        settings.value.islandEdgeRatio = edgeRatioForPosition(area, win, 'top', currentWindowX)
        await placeFromSettings()
        schedulePeek()
        return
      }
      // 其余交给重力：带着甩出速度掉下去，撞墙弹回，最后停到底边；
      // 减少动画时不演物理，直接按底边落位
      if (reducedMotion) {
        settings.value.islandEdge = 'bottom'
        settings.value.islandEdgeRatio = edgeRatioForPosition(area, win, 'bottom', currentWindowX)
        await placeFromSettings()
        schedulePeek()
        return
      }
      await startThrowPhysics(area, fling)
      return
    }
    // 拿不到屏幕信息时退回普通贴边落位
    await placeFromSettings()
    schedulePeek()
  }

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
        cancelPhysics()
        void unretractIsland()
        if (settingsReady.value) void placeFromSettings()
      } else {
        schedulePeek()
      }
    })
  }

  function start() {
    syncClickThrough()
    startHoverPolling()
    void applyWindowSize()
    void installVisibilityWatch()
    schedulePeek()
  }

  function stop() {
    pauseHoverPolling()
    cancelPeekTimer()
    cancelPhysics()
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
    if (ready) {
      void applyWindowSize()
      schedulePeek()
    }
  })

  return {
    hoverActive,
    dragging,
    physicsImpact,
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
