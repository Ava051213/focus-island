import { describe, expect, it } from 'vitest'
import { computeSpawnPoint } from '../spawn'

// 1080 高工作区、scale 1：岛 360×42 贴顶时 island_y = 0，贴底时 = 1038
const ORIGIN = { x: 0, y: 0 }
const metrics = (islandY: number) => ({
  island_x: 780,
  island_y: islandY,
  island_width: 360,
  island_height: 42,
})

describe('computeSpawnPoint · 方向', () => {
  it('岛贴顶：从岛下缘下方冒，向下飘', () => {
    const r = computeSpawnPoint(metrics(0), ORIGIN, 1)
    expect(r.dir).toBe(-1)
    // 岛下缘 42 + 14 间距
    expect(r.y).toBe(56)
  })

  it('岛贴底：从岛上缘上方冒，向上飘', () => {
    const r = computeSpawnPoint(metrics(1038), ORIGIN, 1)
    expect(r.dir).toBe(1)
    // 岛上缘 1038 - 14 间距
    expect(r.y).toBe(1024)
  })

  it('岛不在边缘（不应出现的状态）按贴底处理', () => {
    const r = computeSpawnPoint(metrics(500), ORIGIN, 1)
    expect(r.dir).toBe(1)
    expect(r.y).toBe(486) // 500 - 14
  })
})

describe('computeSpawnPoint · 水平位置', () => {
  it('围绕岛中心 ±120px 随机偏移，且不小于 10', () => {
    for (let i = 0; i < 20; i++) {
      const r = computeSpawnPoint(metrics(0), ORIGIN, 1)
      expect(r.x).toBeGreaterThanOrEqual(10)
      expect(r.x).toBeLessThanOrEqual(780 + 180 + 120)
    }
  })

  it('注入 rand 后偏移可复现', () => {
    const r1 = computeSpawnPoint(metrics(0), ORIGIN, 1, () => 0)
    const r2 = computeSpawnPoint(metrics(0), ORIGIN, 1, () => 0)
    expect(r1.x).toBe(r2.x)
    expect(r1.x).toBe(840) // rand=0 → 最大负偏移：岛中心 960 - 120
  })
})

describe('computeSpawnPoint · 缩放', () => {
  it('scale 2 时坐标减半', () => {
    const r = computeSpawnPoint(metrics(0), ORIGIN, 2)
    expect(r.y).toBe(35) // (0 + 42) / 2 + 14
  })
})
