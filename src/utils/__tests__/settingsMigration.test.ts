import { describe, expect, it } from 'vitest'
import { migrate, UnknownSchemaVersionError } from '../schema'
import { DEFAULT_TOGGLE_SHORTCUT } from '../shortcuts'
import {
  defaultBubbleSettings,
  defaultNotificationSettings,
  defaultShortcutSettings,
  defaultTraySettings,
  migrateSettingsV1ToV2,
  migrateSettingsV2ToV3,
  migrateSettingsV3ToV4,
  migrateSettingsV4ToV5,
  normalizeSettingsShape,
} from '../settingsMigration'

describe('settings 迁移', () => {
  it('v1 补嵌套默认值并映射旧字段', () => {
    const legacy = {
      focusDuration: 30,
      islandOpacity: 0.2,
      shortcutKey: 'Command+Shift+P',
      notificationSound: false,
    }

    const migrated = migrateSettingsV1ToV2(legacy) as Record<string, unknown>

    expect(migrated.focusDuration).toBe(30)
    expect(migrated.shortcuts).toEqual({
      toggleTimer: DEFAULT_TOGGLE_SHORTCUT,
      showWindow: 'Command+Shift+P',
      enabled: true,
    })
    expect(migrated.tray).toEqual(defaultTraySettings())
    expect(migrated.notifications).toEqual({
      ...defaultNotificationSettings(),
      sound: false,
    })
    // 旧字段不再保留，避免两套配置并存
    expect(migrated.shortcutKey).toBeUndefined()
    expect(migrated.notificationSound).toBeUndefined()
  })

  it('没有版本号的裸数据也能补齐结构', () => {
    const normalized = normalizeSettingsShape({ focusDuration: 15 })
    expect(normalized.shortcuts).toEqual(defaultShortcutSettings())
    expect(normalized.tray).toEqual(defaultTraySettings())
    expect(normalized.notifications).toEqual(defaultNotificationSettings())
    expect(normalized.focusDuration).toBe(15)
  })

  it('已经是新结构时只补缺失字段', () => {
    const normalized = normalizeSettingsShape({
      shortcuts: { toggleTimer: 'Ctrl+Shift+P' },
      notifications: { sound: false },
    })
    expect(normalized.shortcuts).toEqual({
      toggleTimer: 'Ctrl+Shift+P',
      showWindow: '',
      enabled: true,
    })
    expect(normalized.notifications).toEqual({
      enabled: true,
      sound: false,
      permissionAsked: false,
    })
  })

  it('通过 migrations 链从 v1 升到 v2', () => {
    const result = migrate<Record<string, unknown>>(
      { schemaVersion: 1, data: { shortcutKey: 'Control+Shift+P' } },
      { currentVersion: 2, migrations: { 1: migrateSettingsV1ToV2 } },
    )

    expect(result.migrated).toBe(true)
    expect((result.data.shortcuts as Record<string, unknown>).showWindow)
      .toBe('Control+Shift+P')
  })

  it('未知高版本仍然抛错，不猜测数据结构', () => {
    expect(() => migrate(
      { schemaVersion: 3, data: {} },
      { currentVersion: 2, migrations: { 1: migrateSettingsV1ToV2 } },
    )).toThrow(UnknownSchemaVersionError)
  })

  it('v2 → v3：islandXRatio 映射成贴边参数并删除旧字段', () => {
    const migrated = migrateSettingsV2ToV3({ islandXRatio: 0.7 }) as Record<string, unknown>
    expect(migrated.islandEdge).toBe('top')
    expect(migrated.islandEdgeRatio).toBeCloseTo(0.7)
    expect(migrated.islandXRatio).toBeUndefined()
  })

  it('v2 → v3：islandXRatio 为 null 时沿边居中', () => {
    const migrated = migrateSettingsV2ToV3({ islandXRatio: null }) as Record<string, unknown>
    expect(migrated.islandEdge).toBe('top')
    expect(migrated.islandEdgeRatio).toBeNull()
  })

  it('v2 → v3：已带贴边字段的数据原样保留', () => {
    const migrated = migrateSettingsV2ToV3({
      islandEdge: 'bottom',
      islandEdgeRatio: 0.3,
    }) as Record<string, unknown>
    expect(migrated.islandEdge).toBe('bottom')
    expect(migrated.islandEdgeRatio).toBeCloseTo(0.3)
  })

  it('非法贴边字段归一化成默认值', () => {
    const normalized = normalizeSettingsShape({
      islandEdge: 'diagonal',
      islandEdgeRatio: Number.NaN,
    })
    expect(normalized.islandEdge).toBe('top')
    expect(normalized.islandEdgeRatio).toBeNull()
  })

  it('通过 migrations 链从 v2 升到 v3', () => {
    const result = migrate<Record<string, unknown>>(
      { schemaVersion: 2, data: { islandXRatio: 0.2 } },
      { currentVersion: 3, migrations: { 1: migrateSettingsV1ToV2, 2: migrateSettingsV2ToV3 } },
    )
    expect(result.migrated).toBe(true)
    expect(result.data.islandEdge).toBe('top')
    expect(result.data.islandEdgeRatio).toBeCloseTo(0.2)
  })

  it('v3 → v4：左右贴边落到底边', () => {
    expect((migrateSettingsV3ToV4({ islandEdge: 'left' }) as Record<string, unknown>).islandEdge).toBe('bottom')
    expect((migrateSettingsV3ToV4({ islandEdge: 'right' }) as Record<string, unknown>).islandEdge).toBe('bottom')
  })

  it('v3 → v4：顶/底贴边原样保留', () => {
    expect((migrateSettingsV3ToV4({ islandEdge: 'top' }) as Record<string, unknown>).islandEdge).toBe('top')
    expect((migrateSettingsV3ToV4({ islandEdge: 'bottom' }) as Record<string, unknown>).islandEdge).toBe('bottom')
  })

  it('v3 → v4：沿边比例跟着保留', () => {
    const migrated = migrateSettingsV3ToV4({ islandEdge: 'left', islandEdgeRatio: 0.4 }) as Record<string, unknown>
    expect(migrated.islandEdge).toBe('bottom')
    expect(migrated.islandEdgeRatio).toBeCloseTo(0.4)
  })

  it('通过 migrations 链从 v3 升到 v4', () => {
    const result = migrate<Record<string, unknown>>(
      { schemaVersion: 3, data: { islandEdge: 'right', islandEdgeRatio: 0.6 } },
      { currentVersion: 4, migrations: { 1: migrateSettingsV1ToV2, 2: migrateSettingsV2ToV3, 3: migrateSettingsV3ToV4 } },
    )
    expect(result.migrated).toBe(true)
    expect(result.data.islandEdge).toBe('bottom')
    expect(result.data.islandEdgeRatio).toBeCloseTo(0.6)
  })

  it('v4 → v5：没有泡泡设置时补全默认值', () => {
    const migrated = migrateSettingsV4ToV5({}) as Record<string, unknown>
    expect(migrated.bubbles).toEqual(defaultBubbleSettings())
  })

  it('v4 → v5：已带泡泡设置时原样保留', () => {
    const migrated = migrateSettingsV4ToV5({
      bubbles: { enabled: false, tone: 'lively', coquetry: false, idleCall: true, comfort: false },
    }) as Record<string, unknown>
    expect(migrated.bubbles).toEqual({
      enabled: false,
      tone: 'lively',
      coquetry: false,
      idleCall: true,
      comfort: false,
    })
  })

  it('v4 → v5：非法档位与缺失字段归一化', () => {
    const migrated = migrateSettingsV4ToV5({ bubbles: { tone: '吵死了' } }) as Record<string, unknown>
    expect(migrated.bubbles).toEqual(defaultBubbleSettings())
  })

  it('通过 migrations 链从 v4 升到 v5', () => {
    const result = migrate<Record<string, unknown>>(
      { schemaVersion: 4, data: { islandEdge: 'top' } },
      { currentVersion: 5, migrations: { 1: migrateSettingsV1ToV2, 2: migrateSettingsV2ToV3, 3: migrateSettingsV3ToV4, 4: migrateSettingsV4ToV5 } },
    )
    expect(result.migrated).toBe(true)
    expect(result.data.islandEdge).toBe('top')
    expect((result.data.bubbles as Record<string, unknown>).enabled).toBe(true)
  })
})
