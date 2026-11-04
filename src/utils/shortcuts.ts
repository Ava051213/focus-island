/**
 * 全局快捷键的纯逻辑：规范化、配置校验、界面展示。
 * 真正的系统注册在 Rust 侧（`update_shortcuts` 命令），这里不接触插件。
 */

/** 默认开始/暂停：Windows/Linux = Ctrl+Alt+Space，macOS = Cmd+Option+Space */
export const DEFAULT_TOGGLE_SHORTCUT = 'CommandOrControl+Alt+Space'

export interface ShortcutConfig {
  toggleTimer: string
  showWindow: string
  enabled: boolean
}

const MODIFIER_ALIASES: Record<string, string> = {
  ctrl: 'Control',
  control: 'Control',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  meta: 'CommandOrControl',
  cmd: 'CommandOrControl',
  command: 'CommandOrControl',
  super: 'CommandOrControl',
  commandorcontrol: 'CommandOrControl',
  commandorctrl: 'CommandOrControl',
  cmdorctrl: 'CommandOrControl',
  cmdorcontrol: 'CommandOrControl',
}

function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent)
}

/** 把 Ctrl/Control、Cmd/Command 等别名统一成一种写法，用于比较重复 */
export function canonicalShortcut(raw: string, mac: boolean = isMacPlatform()): string {
  return raw
    .split('+')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const alias = MODIFIER_ALIASES[part.toLowerCase()]
      if (!alias) return part.toUpperCase()
      // CommandOrControl 在不同平台上等价于 Control 或 Command
      if (alias === 'CommandOrControl') return mac ? 'Command' : 'Control'
      return alias
    })
    .join('+')
}

/**
 * 校验快捷键配置。返回 null 表示可用，否则是给用户看的原因。
 * 禁用状态下不校验具体组合，允许把输入框留空。
 */
export function validateShortcutConfig(config: ShortcutConfig): string | null {
  if (!config.enabled) return null

  const toggle = config.toggleTimer.trim()
  if (!toggle) return '开始/暂停快捷键不能为空；不想用时可以直接关掉全局快捷键'

  const show = config.showWindow.trim()
  if (show && canonicalShortcut(toggle) === canonicalShortcut(show)) {
    return '两个快捷键不能重复，请换一个组合'
  }
  return null
}

/** 设置页展示用：⌘+⌥+Space / Ctrl+Alt+Space */
export function formatShortcut(raw: string, mac: boolean = isMacPlatform()): string {
  const key = raw.trim()
  if (!key) return '未设置'
  return key
    .split('+')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      switch (part.toLowerCase()) {
        case 'commandorcontrol':
        case 'cmdorctrl':
        case 'cmdorcontrol':
          return mac ? '⌘' : 'Ctrl'
        case 'command':
        case 'cmd':
        case 'meta':
        case 'super':
          return '⌘'
        case 'control':
        case 'ctrl':
          return mac ? '⌃' : 'Ctrl'
        case 'alt':
        case 'option':
          return mac ? '⌥' : 'Alt'
        case 'shift':
          return mac ? '⇧' : 'Shift'
        default:
          return part.length === 1 ? part.toUpperCase() : part
      }
    })
    .join('+')
}
