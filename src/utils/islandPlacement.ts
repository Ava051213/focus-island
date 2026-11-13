/**
 * 岛的贴边定位纯逻辑。
 *
 * 定位哲学：岛永远挂在某条边上（top / bottom / left / right），不悬空。
 * - 贴顶 / 贴底：沿边左右滑，ratio 是水平方向的位置比例
 * - 贴左 / 贴右：沿边上下滑，ratio 是垂直方向的位置比例
 * - ratio 为 null 表示沿边居中
 *
 * 这里只做计算，全部物理像素；真正摆窗口由 Rust 的 place_island 命令完成
 * （带 work-area 感知，Rust 侧有一份等价实现并以它为准）。
 */

export type IslandEdge = 'top' | 'bottom' | 'left' | 'right'

export const ISLAND_EDGES: IslandEdge[] = ['top', 'bottom', 'left', 'right']

export function isIslandEdge(value: unknown): value is IslandEdge {
  return value === 'top' || value === 'bottom' || value === 'left' || value === 'right'
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** 可用区域（物理像素）：前端传整块显示器，Rust 传排除任务栏的 work-area */
export interface PlacementArea {
  left: number
  top: number
  width: number
  height: number
}

export interface WindowSize {
  width: number
  height: number
}

/** 沿边方向的窗口原点偏移；ratio null = 居中；窗口比区域还大时贴起点 */
export function offsetAlongEdge(areaLength: number, windowLength: number, ratio: number | null): number {
  const max = areaLength - windowLength
  if (max <= 0) return 0
  const offset = ratio === null ? max / 2 : clamp01(ratio) * max
  return Math.round(offset)
}

/** 按贴边语义算窗口左上角坐标 */
export function islandPositionForEdge(
  area: PlacementArea,
  windowSize: WindowSize,
  edge: IslandEdge,
  ratio: number | null,
): { x: number; y: number } {
  const horizontal = edge === 'top' || edge === 'bottom'
  const alongOffset = horizontal
    ? offsetAlongEdge(area.width, windowSize.width, ratio)
    : offsetAlongEdge(area.height, windowSize.height, ratio)
  const x = edge === 'left'
    ? area.left
    : edge === 'right'
      ? Math.max(area.left, area.left + area.width - windowSize.width)
      : area.left + alongOffset
  const y = edge === 'top'
    ? area.top
    : edge === 'bottom'
      ? Math.max(area.top, area.top + area.height - windowSize.height)
      : area.top + alongOffset
  return { x: Math.round(x), y: Math.round(y) }
}

/** 窗口矩形到区域四条边的距离（可能为负：已经越过该边） */
export function edgeDistances(
  area: PlacementArea,
  windowSize: WindowSize,
  x: number,
  y: number,
): Record<IslandEdge, number> {
  return {
    top: y - area.top,
    bottom: area.top + area.height - (y + windowSize.height),
    left: x - area.left,
    right: area.left + area.width - (x + windowSize.width),
  }
}

/** 最近的边；并列时按 top > bottom > left > right 取先 */
export function nearestEdge(area: PlacementArea, windowSize: WindowSize, x: number, y: number): IslandEdge {
  const d = edgeDistances(area, windowSize, x, y)
  return ISLAND_EDGES.reduce((best, e) => (d[e] < d[best] ? e : best), ISLAND_EDGES[0])
}

/** 按当前窗口位置算沿边比例；窗口比区域还大时返回 null（居中） */
export function edgeRatioForPosition(
  area: PlacementArea,
  windowSize: WindowSize,
  edge: IslandEdge,
  x: number,
  y: number,
): number | null {
  const horizontal = edge === 'top' || edge === 'bottom'
  const areaLength = horizontal ? area.width : area.height
  const windowLength = horizontal ? windowSize.width : windowSize.height
  const max = areaLength - windowLength
  if (max <= 0) return null
  const pos = horizontal ? x : y
  const origin = horizontal ? area.left : area.top
  return clamp01((pos - origin) / max)
}

/**
 * 拖拽中的磁性吸附：距最近的边不足 threshold（物理像素）时，
 * 把垂直于该边的轴吸到边上（沿边方向保持当前滑动位置并夹进区域）。
 * 不够近时返回 null，窗口继续跟手。
 */
export function snapToNearestEdge(
  area: PlacementArea,
  windowSize: WindowSize,
  x: number,
  y: number,
  threshold: number,
): { x: number; y: number; edge: IslandEdge } | null {
  const edge = nearestEdge(area, windowSize, x, y)
  const distance = edgeDistances(area, windowSize, x, y)[edge]
  if (distance > threshold) return null
  const ratio = edgeRatioForPosition(area, windowSize, edge, x, y)
  const snapped = islandPositionForEdge(area, windowSize, edge, ratio)
  return { ...snapped, edge }
}

/** 停靠细条的窗口尺寸：贴顶/底是横条，贴左/右变竖条（scale 为缩放比例） */
export function stripWindowSize(
  edge: IslandEdge,
  scale: number,
  stripThickness: number,
): { width: number; height: number } {
  const vertical = edge === 'left' || edge === 'right'
  return {
    width: (vertical ? stripThickness : 360) * scale,
    height: (vertical ? 360 : stripThickness) * scale,
  }
}
