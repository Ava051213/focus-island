/**
 * 岛的落体物理（纯计算，不碰 Tauri）。
 *
 * 松手后岛继承拖拽的甩出速度：受重力下落，砸到工作区底边（任务栏上沿）
 * 反弹并摩擦减速，撞左右边界弹回，顶边对飞上去的岛是天花板；
 * 能量逐次耗散，最后停稳在底边。全部物理像素，时间单位秒。
 *
 * 这份积分器是确定性的：同样的状态 + 时间步长永远得到同样的结果，
 * 单测可以直接对表。
 */

export interface PhysicsBounds {
  left: number
  top: number
  width: number
  height: number
}

export interface PhysicsState {
  /** 窗口左上角 */
  x: number
  y: number
  /** 速度 px/s */
  vx: number
  vy: number
}

export interface PhysicsParams {
  /** 重力加速度 px/s² */
  gravity: number
  /** 底边反弹保留的法向速度比例（0~1） */
  floorRestitution: number
  /** 顶边反弹保留的法向速度比例（0~1） */
  ceilingRestitution: number
  /** 左右墙反弹保留的速度比例（0~1） */
  wallRestitution: number
  /** 撞地反弹时水平速度保留比例（0~1） */
  floorFriction: number
  /** 贴地滚动时的减速（px/s²） */
  rollFriction: number
  /** 反弹后法向速度低于该值视为不再弹起（px/s） */
  settleSpeed: number
  /** 贴地滚动速度低于该值视为停稳（px/s） */
  settleSpeedX: number
  /** 距地面小于该值且速度趋零视为停稳（px） */
  settleGap: number
  /** 单步积分上限（秒），防止 rAF 卡顿穿地 */
  maxStep: number
  /** 整段物理的最长时长（秒），超时强制收敛 */
  maxDuration: number
}

/** 手感参数集中处；要调弹跳的「弹性」改这里 */
export const PHYSICS: PhysicsParams = {
  gravity: 2600,
  floorRestitution: 0.55,
  ceilingRestitution: 0.5,
  wallRestitution: 0.7,
  floorFriction: 0.85,
  rollFriction: 700,
  settleSpeed: 90,
  settleSpeedX: 60,
  settleGap: 2,
  maxStep: 1 / 120,
  maxDuration: 3,
}

export type PhysicsImpact = 'floor' | 'ceiling' | 'wall' | null

export interface PhysicsStepResult {
  state: PhysicsState
  /** 本步发生的碰撞（给挤压动画用）；贴地滚动不算 */
  impact: PhysicsImpact
  /** 已收敛：可以停机并落位 */
  settled: boolean
}

function bounceOffWalls(
  state: PhysicsState,
  bounds: PhysicsBounds,
  win: { width: number },
  params: PhysicsParams,
): PhysicsImpact {
  const maxX = bounds.left + bounds.width - win.width
  if (state.x < bounds.left) {
    state.x = bounds.left
    state.vx = Math.abs(state.vx) * params.wallRestitution
    return 'wall'
  }
  if (state.x > maxX) {
    state.x = maxX
    state.vx = -Math.abs(state.vx) * params.wallRestitution
    return 'wall'
  }
  return null
}

/** 推进一步：dt 会被切成不超过 maxStep 的子步，避免大帧距穿地 */
export function stepPhysics(
  state: PhysicsState,
  bounds: PhysicsBounds,
  win: { width: number; height: number },
  dt: number,
  params: PhysicsParams = PHYSICS,
): PhysicsStepResult {
  const floorY = Math.max(bounds.top, bounds.top + bounds.height - win.height)
  const ceilingY = bounds.top
  let impact: PhysicsImpact = null
  let settled = false

  let remaining = Math.max(0, Math.min(dt, params.maxStep * 8))
  while (remaining > 0 && !settled) {
    const h = Math.min(remaining, params.maxStep)
    remaining -= h

    // 半隐式欧拉：先更新速度再更新位置
    state.vy += params.gravity * h
    state.x += state.vx * h
    state.y += state.vy * h

    const wall = bounceOffWalls(state, bounds, win, params)
    if (wall && !impact) impact = wall

    // 顶边：对飞上去的岛是天花板，弹回来
    if (state.y < ceilingY) {
      state.y = ceilingY
      state.vy = Math.abs(state.vy) * params.ceilingRestitution
      if (!impact) impact = 'ceiling'
    }

    // 底边：砸地反弹并耗散能量；速度小到不值得再弹就转成贴地滚动
    if (state.y >= floorY) {
      state.y = floorY
      if (Math.abs(state.vy) < params.settleSpeed) {
        state.vy = 0
        // 贴地滚动：摩擦减速，停了就算收敛
        const dv = params.rollFriction * h
        if (Math.abs(state.vx) <= dv) {
          state.vx = 0
        } else {
          state.vx -= Math.sign(state.vx) * dv
        }
        if (Math.abs(state.vx) < params.settleSpeedX) {
          state.vx = 0
          settled = true
        }
      } else {
        impact = 'floor'
        state.vy = -state.vy * params.floorRestitution
        state.vx *= params.floorFriction
      }
    }
  }

  return { state, impact, settled }
}

/** 释放点是否已经稳稳停在地面上且没有竖直速度（直接判停，不用再演） */
export function isRestingOnFloor(
  state: PhysicsState,
  bounds: PhysicsBounds,
  win: { width: number; height: number },
  params: PhysicsParams = PHYSICS,
): boolean {
  const floorY = Math.max(bounds.top, bounds.top + bounds.height - win.height)
  return floorY - state.y <= params.settleGap && Math.abs(state.vy) < params.settleSpeed
}
