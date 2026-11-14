/**
 * 主题颜色派生（纯函数）。
 *
 * 自定义主题只让用户选一个主色（focus），休息色与空闲色从主色派生：
 * - break：色相偏移 150°（互补方向），保持饱和度与亮度——和主色够远、又同属一个体系
 * - idle：降饱和提亮度，做成中性偏冷的信息色
 */

export interface ThemeColors {
  focusColor: string
  breakColor: string
  idleColor: string
}

export function isValidHex(hex: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(hex)
}

interface Hsl {
  h: number
  s: number
  l: number
}

export function hexToHsl(hex: string): Hsl {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) }
}

export function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360 / 360
  const ss = Math.min(100, Math.max(0, s)) / 100
  const ll = Math.min(100, Math.max(0, l)) / 100
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss
  const p = 2 * ll - q
  const channel = (t: number): number => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  const toHex = (v: number): string => {
    const hex = Math.round(v * 255).toString(16)
    return hex.length === 1 ? `0${hex}` : hex
  }
  return `#${toHex(channel(hh + 1 / 3))}${toHex(channel(hh))}${toHex(channel(hh - 1 / 3))}`
}

/** 由主色派生完整主题色 */
export function deriveThemeColors(focusHex: string): ThemeColors {
  const { h, s, l } = hexToHsl(focusHex)
  return {
    focusColor: focusHex.toLowerCase(),
    breakColor: hslToHex(h + 150, s, l),
    idleColor: hslToHex(h + 30, Math.round(s * 0.35), 64),
  }
}
