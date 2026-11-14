/**
 * 岛的贴边定位纯逻辑。
 *
 * 定位哲学：岛永远挂在顶边或底边，不悬空、不贴左右侧。
 * - ratio 是沿边的水平滑动比例 0~1，null 表示沿边居中
 *
 * 这里只做计算，全部物理像素；真正摆窗口由 Rust 的 place_island 命令完成
 * （带 work-area 感知，Rust 侧有一份等价实现并以它为准）。
 */

export type IslandEdge = 'top' | 'bottom'

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
function offsetAlongEdge(areaLength: number, windowLength: number, ratio: number | null): number {
  const max = areaLength - windowLength
  if (max <= 0) return 0
  const offset = ratio === null ? max / 2 : clamp01(ratio) * max
  return Math.round(offset)
}

/** 按贴边语义算窗口左上角坐标；贴底且窗口比区域还高时钳回区域起点 */
function islandPositionForEdge(
  area: PlacementArea,
  windowSize: WindowSize,
  edge: IslandEdge,
  ratio: number | null,
): { x: number; y: number } {
  const x = area.left + offsetAlongEdge(area.width, windowSize.width, ratio)
  const y = edge === 'top'
    ? area.top
    : Math.max(area.top, area.top + area.height - windowSize.height)
  return { x: Math.round(x), y: Math.round(y) }
}

/** 窗口矩形到区域上下两条边的距离（可能为负：已经越过该边） */
export function edgeDistances(
  area: PlacementArea,
  windowSize: WindowSize,
  _x: number,
  y: number,
): Record<IslandEdge, number> {
  return {
    top: y - area.top,
    bottom: area.top + area.height - (y + windowSize.height),
  }
}

/** 最近的边；并列时取顶边 */
export function nearestEdge(area: PlacementArea, windowSize: WindowSize, x: number, y: number): IslandEdge {
  const d = edgeDistances(area, windowSize, x, y)
  return d.top <= d.bottom ? 'top' : 'bottom'
}

/** 按当前窗口位置算沿边比例；窗口比区域还宽时返回 null（居中） */
export function edgeRatioForPosition(
  area: PlacementArea,
  windowSize: WindowSize,
  _edge: IslandEdge,
  x: number,
): number | null {
  const max = area.width - windowSize.width
  if (max <= 0) return null
  return clamp01((x - area.left) / max)
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
  const ratio = edgeRatioForPosition(area, windowSize, edge, x)
  const snapped = islandPositionForEdge(area, windowSize, edge, ratio)
  return { ...snapped, edge }
}
