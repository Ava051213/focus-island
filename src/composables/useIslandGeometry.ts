import { invoke } from '@tauri-apps/api/core'
import { availableMonitors, getCurrentWindow } from '@tauri-apps/api/window'
import { useSettings } from './useSettings'

/**
 * 岛窗口的共享几何缓存（模块级单例，仅 main 窗口使用）。
 *
 * 悬停、拖拽、闲置收起、窗口尺寸四块逻辑都读写同一份缓存：
 * 屏幕列表、虚拟桌面边界、窗口尺寸与当前位置。
 * Rust 的 place_island 带 work-area 感知，是位置的最终裁决；
 * 这里的缓存只服务拖拽跟手与边界判定。
 */

export interface ScreenRect {
  left: number
  top: number
  width: number
  height: number
}

export const islandGeom = {
  screens: [] as ScreenRect[],
  virtualLeft: 0,
  virtualRight: 0,
  virtualTop: 0,
  virtualBottom: 0,
  windowWidth: 0,
  windowHeight: 0,
  currentWindowX: 0,
  currentWindowY: 0,
}

export async function refreshIslandGeometry() {
  try {
    const list = await availableMonitors()
    islandGeom.screens = list.map(m => ({
      left: m.position.x,
      top: m.position.y,
      width: m.size.width,
      height: m.size.height,
    }))
    if (islandGeom.screens.length > 0) {
      islandGeom.virtualLeft = Math.min(...islandGeom.screens.map(s => s.left))
      islandGeom.virtualRight = Math.max(...islandGeom.screens.map(s => s.left + s.width))
      islandGeom.virtualTop = Math.min(...islandGeom.screens.map(s => s.top))
      islandGeom.virtualBottom = Math.max(...islandGeom.screens.map(s => s.top + s.height))
    }
    const islandWindow = getCurrentWindow()
    const size = await islandWindow.outerSize()
    const pos = await islandWindow.outerPosition()
    islandGeom.windowWidth = size.width
    islandGeom.windowHeight = size.height
    islandGeom.currentWindowX = pos.x
    islandGeom.currentWindowY = pos.y
  } catch {
    // 平台不支持时保持旧值
  }
}

/** 按窗口中心点找所在屏幕；落在缝隙里就取中心最近的一块 */
export function screenForPoint(centerX: number, centerY: number): ScreenRect | null {
  const { screens } = islandGeom
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

// 拖动范围放宽到整个虚拟桌面，岛可以跨到副屏
export function clampToVirtualDesktop(x: number, y: number): { x: number; y: number } {
  const { virtualLeft, virtualRight, virtualTop, virtualBottom, windowWidth, windowHeight } = islandGeom
  const maxX = virtualRight - virtualLeft - windowWidth
  const maxY = virtualBottom - virtualTop - windowHeight
  const cx = Math.round(Math.min(Math.max(x, virtualLeft), maxX > 0 ? virtualLeft + maxX : virtualLeft))
  const cy = Math.round(Math.min(Math.max(y, virtualTop), maxY > 0 ? virtualTop + maxY : virtualTop))
  return { x: cx, y: cy }
}

/**
 * 按设置里的贴边参数让 Rust 摆窗口（Rust 带 work-area 感知）。
 * 顺手刷新本地几何缓存。
 */
export async function placeFromSettings() {
  const { settings } = useSettings()
  const edge = settings.value.islandEdge
  const ratio = settings.value.islandEdgeRatio
  try {
    await invoke('place_island', { edge, ratio })
  } catch {
    // 命令不可用时忽略
  }
  await refreshIslandGeometry()
}
