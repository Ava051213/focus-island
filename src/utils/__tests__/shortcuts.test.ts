import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TOGGLE_SHORTCUT,
  canonicalShortcut,
  formatShortcut,
  validateShortcutConfig,
} from '../shortcuts'

describe('canonicalShortcut', () => {
  it('Ctrl 与 Control 在 Windows 上视为同一个键', () => {
    expect(canonicalShortcut('Ctrl+Alt+Space', false)).toBe('Control+Alt+SPACE')
    expect(canonicalShortcut('Control+Alt+Space', false)).toBe('Control+Alt+SPACE')
  })

  it('CommandOrControl 按平台归一', () => {
    expect(canonicalShortcut(DEFAULT_TOGGLE_SHORTCUT, false)).toBe('Control+Alt+SPACE')
    expect(canonicalShortcut(DEFAULT_TOGGLE_SHORTCUT, true)).toBe('Command+Alt+SPACE')
  })

  it('字母键大小写统一', () => {
    expect(canonicalShortcut('Control+Shift+p', false)).toBe('Control+Shift+P')
  })
})

describe('validateShortcutConfig', () => {
  it('空快捷键在启用时报错', () => {
    expect(validateShortcutConfig({ enabled: true, toggleTimer: '', showWindow: '' }))
      .toContain('不能为空')
    expect(validateShortcutConfig({ enabled: true, toggleTimer: '   ', showWindow: '' }))
      .toContain('不能为空')
  })

  it('两个快捷键重复时报错', () => {
    expect(validateShortcutConfig({
      enabled: true,
      toggleTimer: 'Ctrl+Alt+Space',
      showWindow: 'Control+Alt+Space',
    })).toContain('不能重复')
  })

  it('禁用时不校验具体组合', () => {
    expect(validateShortcutConfig({ enabled: false, toggleTimer: '', showWindow: '' })).toBeNull()
    expect(validateShortcutConfig({
      enabled: false,
      toggleTimer: 'Ctrl+Alt+Space',
      showWindow: 'Ctrl+Alt+Space',
    })).toBeNull()
  })

  it('合法配置返回 null', () => {
    expect(validateShortcutConfig({
      enabled: true,
      toggleTimer: 'Ctrl+Alt+Space',
      showWindow: 'Ctrl+Shift+P',
    })).toBeNull()
  })
})

describe('formatShortcut', () => {
  it('空值显示未设置', () => {
    expect(formatShortcut('')).toBe('未设置')
  })

  it('Windows 显示 Ctrl+Alt+Space', () => {
    expect(formatShortcut(DEFAULT_TOGGLE_SHORTCUT, false)).toBe('Ctrl+Alt+Space')
    expect(formatShortcut('Control+Shift+P', false)).toBe('Ctrl+Shift+P')
  })

  it('macOS 使用符号', () => {
    expect(formatShortcut(DEFAULT_TOGGLE_SHORTCUT, true)).toBe('⌘+⌥+Space')
  })
})
