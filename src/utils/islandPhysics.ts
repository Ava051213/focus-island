/**
 * 岛的落体物理（纯计算，不碰 Tauri）。
 *
 * 松手后岛受重力下落，砸到工作区底边（任务栏上沿）反弹，
 * 能量逐次耗散，收敛后停在底边。全部物理像素，时间单位秒。
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
  /** 反弹后法向速度低于该值视为不再弹起（px/s） */
  settleSpeed: number
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
  settleSpeed: 90,
  settleGap: 2,
  maxStep: 1 / 120,
  maxDuration: 3,
}

export interface PhysicsStepResult {
  state: PhysicsState
  /** 本步撞了地面（弹跳事件，给挤压动画用） */
  landed: boolean
  /** 已收敛：可以停机并落位 */
  settled: boolean
}

function clampX(state: PhysicsState, bounds: PhysicsBounds, win: { width: number }): void {
  const maxX = bounds.left + bounds.width - win.width
  if (state.x < bounds.left) {
    state.x = bounds.left
    state.vx = 0
  } else if (state.x > maxX) {
    state.x = maxX
    state.vx = 0
  }
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
  let landed = false
  let settled = false

  let remaining = Math.max(0, Math.min(dt, params.maxStep * 8))
  while (remaining > 0 && !settled) {
    const h = Math.min(remaining, params.maxStep)
    remaining -= h

    // 半隐式欧拉：先更新速度再更新位置
    state.vy += params.gravity * h
    state.x += state.vx * h
    state.y += state.vy * h
    clampX(state, bounds, win)

    // 顶边：撞上弹回（顶边是停靠位不是墙，只对飞上去的岛生效）
    if (state.y < ceilingY) {
      state.y = ceilingY
      state.vy = Math.abs(state.vy) * params.ceilingRestitution
    }

    // 底边：砸地反弹，能量耗散
    if (state.y >= floorY) {
      state.y = floorY
      landed = true
      if (Math.abs(state.vy) < params.settleSpeed) {
        // 砸地的速度已经小到不值得再弹：停稳
        state.vy = 0
        settled = true
      } else {
        state.vy = -state.vy * params.floorRestitution
      }
    }
  }

  return { state, landed, settled }
}

/** 释放点是否停在地面附近且基本没有竖直速度（直接判停，不用再演） */
export function isRestingOnFloor(
  state: PhysicsState,
  bounds: PhysicsBounds,
  win: { width: number; height: number },
  params: PhysicsParams = PHYSICS,
): boolean {
  const floorY = Math.max(bounds.top, bounds.top + bounds.height - win.height)
  return floorY - state.y <= params.settleGap && Math.abs(state.vy) < params.settleSpeed
}
