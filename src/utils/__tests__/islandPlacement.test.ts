import { describe, expect, it } from 'vitest'
import {
  clamp01,
  edgeDistances,
  edgeRatioForPosition,
  nearestEdge,
  snapToNearestEdge,
} from '../islandPlacement'

// 1920×1080 显示器、360×42 窗口（物理像素）
const AREA = { left: 0, top: 0, width: 1920, height: 1080 }
const WIN = { width: 360, height: 42 }

// islandPositionForEdge / offsetAlongEdge 已转为模块私有（Rust 侧是权威实现），
// 通过 snapToNearestEdge 与贴边落位场景间接覆盖。


describe('islandPositionForEdge（经 snapToNearestEdge 间接覆盖）', () => {
  it('贴顶吸附落在顶边居中位', () => {
    expect(snapToNearestEdge(AREA, WIN, 500, 8, 24)).toEqual({ x: 500, y: 0, edge: 'top' })
  })

  it('贴底吸附落在工作区底部', () => {
    expect(snapToNearestEdge(AREA, WIN, 500, 1100, 24)).toEqual({ x: 500, y: 1038, edge: 'bottom' })
  })

  it('比例超界按 0~1 钳制（横向往右越界时被夹回右端）', () => {
    expect(snapToNearestEdge(AREA, WIN, 2500, 8, 24)).toEqual({ x: 1560, y: 0, edge: 'top' })
  })
})

describe('edgeDistances / nearestEdge', () => {
  it('算出到上下两条边的距离', () => {
    expect(edgeDistances(AREA, WIN, 100, 200)).toEqual({
      top: 200,
      bottom: 838,
    })
  })

  it('取最近的边，越过边时距离为负仍然选中', () => {
    expect(nearestEdge(AREA, WIN, 100, 10)).toBe('top')
    // y 超过工作区底部（比如压到任务栏区），bottom 为负
    expect(nearestEdge(AREA, WIN, 100, 1100)).toBe('bottom')
    // 左右不再参与：x=10 时上下距离相同，按顶边处理
    expect(nearestEdge(AREA, WIN, 10, 500)).toBe('top')
    expect(nearestEdge(AREA, WIN, 1900, 900)).toBe('bottom')
  })
})

describe('edgeRatioForPosition', () => {
  it('按当前窗口位置反算沿边比例', () => {
    expect(edgeRatioForPosition(AREA, WIN, 'top', 780)).toBeCloseTo(0.5)
    expect(edgeRatioForPosition(AREA, WIN, 'bottom', 780)).toBeCloseTo(0.5)
  })

  it('钳进 0~1', () => {
    expect(edgeRatioForPosition(AREA, WIN, 'top', -50)).toBe(0)
    expect(edgeRatioForPosition(AREA, WIN, 'top', 1900)).toBe(1)
  })

  it('窗口比区域还宽时返回 null', () => {
    expect(edgeRatioForPosition(AREA, { width: 3000, height: 42 }, 'top', 0)).toBeNull()
  })
})

describe('snapToNearestEdge', () => {
  it('距边不足阈值时吸到边上，沿边方向保留当前位置', () => {
    // 距顶边 10px（< 24），x 保持 500
    const snapped = snapToNearestEdge(AREA, WIN, 500, 10, 24)
    expect(snapped).toEqual({ x: 500, y: 0, edge: 'top' })
  })

  it('够远时不吸附', () => {
    expect(snapToNearestEdge(AREA, WIN, 500, 300, 24)).toBeNull()
  })

  it('贴底吸附时窗口压过工作区底部会被顶回来', () => {
    // y=1100 已越过工作区底（比如压进任务栏区），吸附回底边
    const snapped = snapToNearestEdge(AREA, WIN, 500, 1100, 24)
    expect(snapped).toEqual({ x: 500, y: 1038, edge: 'bottom' })
  })

  it('横向位置再偏也只在上下两条边里选', () => {
    // x=1900 已越过右边界，但左右贴边已移除：按上下距离选
    const snapped = snapToNearestEdge(AREA, WIN, 1900, 8, 24)
    expect(snapped).toEqual({ x: 1560, y: 0, edge: 'top' })
  })
})

describe('clamp01', () => {
  it('钳到 0~1', () => {
    expect(clamp01(1.5)).toBe(1)
    expect(clamp01(-0.2)).toBe(0)
    expect(clamp01(0.4)).toBe(0.4)
  })
})
