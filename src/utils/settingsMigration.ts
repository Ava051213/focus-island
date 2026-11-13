/**
 * settings.json 的结构迁移与归一化。
 *
 * 第一步的 settings 是扁平结构（shortcutKey / notificationSound）；
 * 这里统一升级成嵌套结构，并把旧字段映射过去。
 * 迁移函数本身不改文件，由 persistence 的 migrate 入口调用。
 */
import { clamp01, isIslandEdge } from './islandPlacement'
import { DEFAULT_TOGGLE_SHORTCUT, canonicalShortcut } from './shortcuts'

export interface ShortcutSettings {
  toggleTimer: string
  showWindow: string
  enabled: boolean
}

export interface TraySettings {
  closeToTray: boolean
}

export interface NotificationSettings {
  enabled: boolean
  sound: boolean
  /** 已经申请过一次系统通知权限，拒绝后不再反复弹 */
  permissionAsked: boolean
}

export function defaultShortcutSettings(): ShortcutSettings {
  return {
    toggleTimer: DEFAULT_TOGGLE_SHORTCUT,
    showWindow: '',
    enabled: true,
  }
}

export function defaultTraySettings(): TraySettings {
  return { closeToTray: true }
}

export function defaultNotificationSettings(): NotificationSettings {
  return { enabled: true, sound: true, permissionAsked: false }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 同时兼容两种输入：
 * - 旧的扁平结构（shortcutKey / notificationSound）
 * - 已经是新结构但可能缺字段的数据
 * 返回的对象一定带完整的 shortcuts / tray / notifications。
 */
export function normalizeSettingsShape(raw: unknown): Record<string, unknown> {
  const record = isRecord(raw) ? { ...raw } : {}

  const legacyShortcut = typeof record.shortcutKey === 'string' ? record.shortcutKey.trim() : ''
  const legacySound = typeof record.notificationSound === 'boolean' ? record.notificationSound : undefined
  delete record.shortcutKey
  delete record.notificationSound

  const shortcutsRaw = isRecord(record.shortcuts) ? record.shortcuts : null
  const toggleTimer = typeof shortcutsRaw?.toggleTimer === 'string'
    ? shortcutsRaw.toggleTimer
    : DEFAULT_TOGGLE_SHORTCUT

  let showWindow = typeof shortcutsRaw?.showWindow === 'string'
    ? shortcutsRaw.showWindow
    : legacyShortcut
  // 旧快捷键如果正好等于新的开始/暂停默认键，就不再占用第二个动作
  if (!shortcutsRaw && showWindow && canonicalShortcut(showWindow) === canonicalShortcut(toggleTimer)) {
    showWindow = ''
  }

  record.shortcuts = {
    toggleTimer,
    showWindow,
    enabled: typeof shortcutsRaw?.enabled === 'boolean' ? shortcutsRaw.enabled : true,
  }

  const trayRaw = isRecord(record.tray) ? record.tray : null
  record.tray = {
    closeToTray: typeof trayRaw?.closeToTray === 'boolean' ? trayRaw.closeToTray : true,
  }

  const notificationsRaw = isRecord(record.notifications) ? record.notifications : null
  record.notifications = {
    enabled: typeof notificationsRaw?.enabled === 'boolean' ? notificationsRaw.enabled : true,
    sound: typeof notificationsRaw?.sound === 'boolean'
      ? notificationsRaw.sound
      : (legacySound ?? true),
    permissionAsked: typeof notificationsRaw?.permissionAsked === 'boolean'
      ? notificationsRaw.permissionAsked
      : false,
  }

  // 贴边定位：岛只贴四边。旧字段 islandXRatio 映射成 top 边的沿边比例。
  const legacyX = typeof record.islandXRatio === 'number' && Number.isFinite(record.islandXRatio)
    ? clamp01(record.islandXRatio)
    : null
  delete record.islandXRatio
  record.islandEdge = isIslandEdge(record.islandEdge) ? record.islandEdge : 'top'
  record.islandEdgeRatio = typeof record.islandEdgeRatio === 'number' && Number.isFinite(record.islandEdgeRatio)
    ? clamp01(record.islandEdgeRatio)
    : legacyX

  return record
}

/** schemaVersion 1 → 2：补嵌套结构，映射旧字段 */
export function migrateSettingsV1ToV2(data: unknown): unknown {
  return normalizeSettingsShape(data)
}

/** schemaVersion 2 → 3：islandXRatio → islandEdge + islandEdgeRatio（贴边定位） */
export function migrateSettingsV2ToV3(data: unknown): unknown {
  return normalizeSettingsShape(data)
}
