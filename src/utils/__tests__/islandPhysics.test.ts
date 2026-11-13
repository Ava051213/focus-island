import { describe, expect, it } from 'vitest'
import { PHYSICS, isRestingOnFloor, stepPhysics, type PhysicsState } from '../islandPhysics'

// 1920×1080 工作区、360×42 窗口：地面在 y=1038
const BOUNDS = { left: 0, top: 0, width: 1920, height: 1080 }
const WIN = { width: 360, height: 42 }
const FLOOR_Y = 1080 - 42

/** 固定步长模拟到收敛（上限给足，弹性高时弹跳链很长），统计碰撞次数 */
function simulate(state: PhysicsState, dt = 1 / 60) {
  let floorHits = 0
  let wallHits = 0
  let settled = false
  let elapsed = 0
  while (!settled && elapsed < 12) {
    const r = stepPhysics(state, BOUNDS, WIN, dt)
    if (r.impact === 'floor') floorHits += 1
    if (r.impact === 'wall-left' || r.impact === 'wall-right') wallHits += 1
    settled = r.settled
    elapsed += dt
  }
  return { floorHits, wallHits, settled, elapsed }
}

describe('stepPhysics · 重力', () => {
  it('每步速度按重力累加', () => {
    const s: PhysicsState = { x: 500, y: 200, vx: 0, vy: 0 }
    stepPhysics(s, BOUNDS, WIN, 1 / 60)
    expect(s.vy).toBeCloseTo(PHYSICS.gravity / 60, 0)
    expect(s.y).toBeGreaterThan(200)
  })

  it('大步长不会穿地（子步切分 + 碰撞钳制）', () => {
    const s: PhysicsState = { x: 500, y: 200, vx: 0, vy: 0 }
    stepPhysics(s, BOUNDS, WIN, 0.25)
    expect(s.y).toBeLessThanOrEqual(FLOOR_Y)
    expect(s.y).toBeGreaterThanOrEqual(BOUNDS.top)
  })
})

describe('stepPhysics · 弹跳收敛', () => {
  it('半空松手：落地反弹多次后停稳在底边', () => {
    const s: PhysicsState = { x: 500, y: 200, vx: 0, vy: 0 }
    const r = simulate(s)
    expect(r.settled).toBe(true)
    expect(r.floorHits).toBeGreaterThanOrEqual(2)
    expect(s.y).toBe(FLOOR_Y)
    expect(s.vy).toBe(0)
    expect(s.vx).toBe(0)
  })

  it('每次反弹的法向速度按弹性系数递减', () => {
    const s: PhysicsState = { x: 500, y: 200, vx: 0, vy: 0 }
    const vys: number[] = []
    let lastVy = 0
    for (let i = 0; i < 600; i++) {
      const r = stepPhysics(s, BOUNDS, WIN, 1 / 60)
      if (r.impact === 'floor') {
        vys.push(Math.abs(lastVy))
        if (r.settled) break
      }
      lastVy = s.vy
    }
    // 每次砸地的速度都比上一次小
    for (let i = 1; i < vys.length; i++) {
      expect(vys[i]).toBeLessThan(vys[i - 1])
    }
  })

  it('已经停在地面上时一步收敛', () => {
    const s: PhysicsState = { x: 500, y: FLOOR_Y, vx: 0, vy: 0 }
    const r = stepPhysics(s, BOUNDS, WIN, 1 / 60)
    expect(r.settled).toBe(true)
    expect(s.y).toBe(FLOOR_Y)
  })

  it('超时会强制收敛，不会永远弹', () => {
    const s: PhysicsState = { x: 500, y: 200, vx: 0, vy: 0 }
    const r = simulate(s, 1 / 240)
    expect(r.settled).toBe(true)
    expect(r.elapsed).toBeLessThanOrEqual(PHYSICS.maxDuration + 1 / 240)
  })
})

describe('stepPhysics · 墙壁与顶边', () => {
  it('横甩撞墙弹回并最终停稳', () => {
    const s: PhysicsState = { x: 1700, y: 500, vx: 2000, vy: 0 }
    const r = simulate(s)
    expect(r.wallHits).toBeGreaterThanOrEqual(1)
    expect(r.settled).toBe(true)
    expect(s.x).toBeGreaterThanOrEqual(BOUNDS.left)
    expect(s.x).toBeLessThanOrEqual(BOUNDS.left + BOUNDS.width - WIN.width)
    expect(s.y).toBe(FLOOR_Y)
  })

  it('上抛撞顶弹落', () => {
    const s: PhysicsState = { x: 500, y: 30, vx: 0, vy: -1500 }
    const r = simulate(s)
    expect(r.settled).toBe(true)
    expect(s.y).toBe(FLOOR_Y)
  })

  it('贴地横滚靠摩擦减速停稳', () => {
    const s: PhysicsState = { x: 500, y: FLOOR_Y, vx: 800, vy: 0 }
    const r = simulate(s)
    expect(r.settled).toBe(true)
    expect(s.vx).toBe(0)
    expect(s.y).toBe(FLOOR_Y)
    // 摩擦滑行距离有限（800² / (2·380) ≈ 842px）
    expect(s.x).toBeGreaterThan(1000)
    expect(s.x).toBeLessThan(1500)
  })
})

describe('isRestingOnFloor', () => {
  it('贴地且无竖直速度为真', () => {
    expect(isRestingOnFloor({ x: 500, y: FLOOR_Y, vx: 0, vy: 0 }, BOUNDS, WIN)).toBe(true)
  })

  it('半空中为假', () => {
    expect(isRestingOnFloor({ x: 500, y: 200, vx: 0, vy: 0 }, BOUNDS, WIN)).toBe(false)
  })
})
