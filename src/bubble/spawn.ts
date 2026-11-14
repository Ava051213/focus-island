/**
 * 泡泡出生点计算（纯函数）。
 *
 * 从岛缘留 14px 间距冒出，永远飘向对侧：
 * 岛贴顶 → 从岛下缘下方冒、向下飘；岛贴底 → 从岛上缘上方冒、向上飘。
 * Rust 的 place/raise 只管窗口本身，这里只算渲染坐标。
 */

export interface IslandRectMetrics {
  island_x: number
  island_y: number
  island_width: number
  island_height: number
}

export interface SpawnResult {
  x: number
  y: number
  dir: 1 | -1
}

const EDGE_GAP_PX = 14
/** 岛窗口上缘距工作区顶不足这个值视为贴顶 */
const TOP_DOCK_EPSILON = 40
const X_JITTER = 240
const MIN_X = 10

export function computeSpawnPoint(
  metrics: IslandRectMetrics,
  origin: { x: number; y: number },
  scale: number,
  rand: () => number = Math.random,
): SpawnResult {
  const centerX = (metrics.island_x + metrics.island_width / 2 - origin.x) / scale
  const islandLocalY = metrics.island_y - origin.y
  const fromTop = islandLocalY < TOP_DOCK_EPSILON
  const edgeY = fromTop
    ? (islandLocalY + metrics.island_height) / scale
    : islandLocalY / scale
  return {
    x: Math.max(MIN_X, centerX + (rand() * X_JITTER - X_JITTER / 2)),
    y: Math.max(10, fromTop ? edgeY + EDGE_GAP_PX : edgeY - EDGE_GAP_PX),
    dir: fromTop ? -1 : 1,
  }
}
