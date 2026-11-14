import { describe, expect, it } from 'vitest'
import { deriveThemeColors, hexToHsl, hslToHex, isValidHex } from '../themeColors'

describe('isValidHex', () => {
  it('只接受 #rrggbb', () => {
    expect(isValidHex('#f0682e')).toBe(true)
    expect(isValidHex('#F0682E')).toBe(true)
    expect(isValidHex('f0682e')).toBe(false)
    expect(isValidHex('#f06')).toBe(false)
    expect(isValidHex('')).toBe(false)
  })
})

describe('hexToHsl / hslToHex', () => {
  it('往返转换误差在取整范围内', () => {
    const hex = '#f0682e'
    const { h, s, l } = hexToHsl(hex)
    const back = hslToHex(h, s, l)
    // 换算取整可能有一两级的色差，逐通道容差 ≤2
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(parseInt(back.slice(1 + i * 2, 3 + i * 2), 16)
        - parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16))).toBeLessThanOrEqual(2)
    }
  })

  it('灰色的色相为 0、饱和度为 0', () => {
    const { h, s } = hexToHsl('#808080')
    expect(h).toBe(0)
    expect(s).toBe(0)
  })
})

describe('deriveThemeColors', () => {
  it('focus 保持原色', () => {
    const t = deriveThemeColors('#f0682e')
    expect(t.focusColor).toBe('#f0682e')
  })

  it('break 与 focus 拉开足够远的色相距离', () => {
    const t = deriveThemeColors('#f0682e')
    const h1 = hexToHsl(t.focusColor).h
    const h2 = hexToHsl(t.breakColor).h
    const dist = Math.min(Math.abs(h1 - h2), 360 - Math.abs(h1 - h2))
    expect(dist).toBeGreaterThan(90)
    expect(dist).toBeLessThan(210)
  })

  it('idle 是低饱和的中性色', () => {
    const t = deriveThemeColors('#f0682e')
    const idle = hexToHsl(t.idleColor)
    expect(idle.s).toBeLessThan(40)
    expect(idle.l).toBeGreaterThan(50)
  })

  it('非法输入直接透传不抛错', () => {
    expect(() => deriveThemeColors('nonsense')).not.toThrow()
  })
})
