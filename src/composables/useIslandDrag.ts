import { ref, type Ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow, PhysicalPosition } from '@tauri-apps/api/window'
import { useSettings } from './useSettings'
import { useIslandPeek } from './useIslandPeek'
import type { NotificationType } from './useTimer'
import {
  clampToVirtualDesktop,
  placeFromSettings,
  refreshIslandGeometry,
  screenForPoint,
  islandGeom,
} from './useIslandGeometry'
import {
  edgeDistances,
  edgeRatioForPosition,
  snapToNearestEdge,
  type PlacementArea,
} from '../utils/islandPlacement'
import { FLING, PHYSICS, isRestingOnFloor, stepPhysics, type PhysicsImpact } from '../utils/islandPhysics'

/**
 * 岛的拖拽与松手物理（模块级单例，仅 main 窗口使用）。
 *
 * 拖拽全向跟手 + 磁性吸附（24px 内贴上下边）；松手时慢速贴顶停靠、
 * 其余交给重力：带着甩出速度掉落弹跳，最后停稳在底边。
 * 下落期间随时可被抓住（pointerdown 取消物理）。
 */

// 拖拽中的磁性吸附距离（CSS 像素），转物理像素要乘 dpr
const MAGNET_SNAP_CSS_PX = 24

const dragging = ref(false)
/** 最近一次物理碰撞（带自增 id，连续同类型碰撞也能触发动画） */
const physicsImpact = ref<{ kind: PhysicsImpact; id: number } | null>(null)
let impactSeq = 0

// 落体物理：rAF 驱动，松手到落定之间 physicsActive 为真
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

export function isDragging() {
  return dragging.value
}

export function isPhysicsActive() {
  return physicsActive
}

export interface IslandDragOptions {
  notificationType: Ref<NotificationType>
}

export function useIslandDrag(options: IslandDragOptions) {
  const { settings } = useSettings()
  const { cancelPeekTimer, unretractIsland, schedulePeek } = useIslandPeek({
    notificationType: options.notificationType,
    isDragging,
    isPhysicsActive,
  })
  const islandWindow = getCurrentWindow()

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
    const win = { width: islandGeom.windowWidth, height: islandGeom.windowHeight }
    const pbounds = { left: bounds[0], top: bounds[1], width: bounds[2], height: bounds[3] }
    const state = { x: islandGeom.currentWindowX, y: islandGeom.currentWindowY, vx: velocity.vx, vy: velocity.vy }
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

  /** 点击胶囊 = 开关面板；刚结束一次拖拽时吞掉误触 */
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
    dragStartWindowX = islandGeom.currentWindowX
    dragStartWindowY = islandGeom.currentWindowY
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
    const screen = screenForPoint(x + islandGeom.windowWidth / 2, y + islandGeom.windowHeight / 2)
    if (screen) {
      const area: PlacementArea = { left: screen.left, top: screen.top, width: screen.width, height: screen.height }
      const snapped = snapToNearestEdge(
        area,
        { width: islandGeom.windowWidth, height: islandGeom.windowHeight },
        x,
        y,
        MAGNET_SNAP_CSS_PX * dpr,
      )
      if (snapped) {
        x = snapped.x
        y = snapped.y
      }
    }
    islandGeom.currentWindowX = x
    islandGeom.currentWindowY = y
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
    const win = { width: islandGeom.windowWidth, height: islandGeom.windowHeight }
    const fling = estimateFlingVelocity()
    const screen = screenForPoint(
      islandGeom.currentWindowX + islandGeom.windowWidth / 2,
      islandGeom.currentWindowY + islandGeom.windowHeight / 2,
    )
    if (screen) {
      const area: PlacementArea = { left: screen.left, top: screen.top, width: screen.width, height: screen.height }
      // 慢速且贴近顶边：照旧吸附停靠，不演物理；甩上去的会撞顶弹回来
      const dTop = edgeDistances(area, win, islandGeom.currentWindowX, islandGeom.currentWindowY).top
      const flingSpeed = Math.hypot(fling.vx, fling.vy)
      // 系统要求减少动画：跳过物理，直接落到最近边
      const reducedMotion = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (!reducedMotion && dTop <= MAGNET_SNAP_CSS_PX * (window.devicePixelRatio || 1) && flingSpeed < FLING.dockSpeed) {
        settings.value.islandEdge = 'top'
        settings.value.islandEdgeRatio = edgeRatioForPosition(area, win, 'top', islandGeom.currentWindowX)
        await placeFromSettings()
        schedulePeek()
        return
      }
      // 其余交给重力：带着甩出速度掉下去，撞墙弹回，最后停到底边；
      // 减少动画时不演物理，直接按底边落位
      if (reducedMotion) {
        settings.value.islandEdge = 'bottom'
        settings.value.islandEdgeRatio = edgeRatioForPosition(area, win, 'bottom', islandGeom.currentWindowX)
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

  return {
    dragging,
    physicsImpact,
    cancelPhysics,
    onIslandClick,
    onCapsulePointerDown,
    onCapsulePointerMove,
    onCapsulePointerUp,
  }
}
