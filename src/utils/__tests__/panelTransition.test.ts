import { describe, expect, it } from 'vitest'
import { panelLiftSign, panelOpensUpward, panelOriginY } from '../panelTransition'

describe('panelOpensUpward', () => {
  it('面板中心在岛中心上方 → 从底边长出', () => {
    expect(panelOpensUpward(1000, 500)).toBe(true)
  })

  it('面板在岛下方（默认朝向）', () => {
    expect(panelOpensUpward(100, 500)).toBe(false)
  })

  it('中心齐平时按默认朝向处理', () => {
    expect(panelOpensUpward(500, 500)).toBe(false)
  })
})

describe('panelOriginY / panelLiftSign', () => {
  it('向上展开：原点翻到底部、上抬反向', () => {
    expect(panelOriginY(true)).toBe('100%')
    expect(panelLiftSign(true)).toBe(1)
  })

  it('向下展开：保持默认', () => {
    expect(panelOriginY(false)).toBe('0%')
    expect(panelLiftSign(false)).toBe(-1)
  })
})
