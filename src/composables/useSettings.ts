import { ref, computed, watch, watchEffect } from 'vue'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { createPersistedStore } from './persistence'
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
  type BubbleSettings,
  type NotificationSettings,
  type ShortcutSettings,
  type TraySettings,
} from '../utils/settingsMigration'
import type { IslandEdge } from '../utils/islandPlacement'
import { isValidHex, deriveThemeColors } from '../utils/themeColors'

export type { IslandEdge }

export interface ThemePreset {
  id: string
  name: string
  focusColor: string
  breakColor: string
  idleColor: string
  /** 需要达成本周目标才能使用的奖励主题 */
  rewardId?: string
}

export const CUSTOM_THEME_ID = 'custom'

export type ColorMode = 'dark' | 'light' | 'system'

export type IslandDisplayMode = 'resident' | 'dock'

export interface Settings {
  islandOpacity: number      // 透明度 0~0.7，值越大越透明，CSS alpha = 1 - value
  islandScale: number        // 灵动岛缩放比例 0.5~1.5
  islandDisplayMode: IslandDisplayMode  // 灵动岛显示方式：常驻 / 边缘停靠
  islandEdge: IslandEdge                // 岛贴在哪条边（只贴边不悬空）
  islandEdgeRatio: number | null        // 沿边的滑动比例 0~1，null 表示沿边居中
  islandPeek: boolean                   // 闲置时滑出屏只留一条细边（常驻模式）
  bubbles: BubbleSettings               // 岛吐泡泡：未晚随口说句话的开关组
  focusDuration: number
  breakDuration: number
  colorMode: ColorMode
  activeThemeId: string
  /** 自定义主题的主色（#rrggbb），activeThemeId 为 custom 时生效 */
  customFocusColor: string
  idleMottos: string[]       // 空闲时轮播的激励语，空数组则用内置默认
  shortcuts: ShortcutSettings      // 全局快捷键（开始/暂停、打开清单）
  tray: TraySettings               // 关闭窗口时隐藏到托盘
  notifications: NotificationSettings // 系统通知开关与声音
  autoLaunch: boolean       // 开机自动启动
  aiSiliconKey: string      // 硅基流动 API Key（主力平台，仅存本机）
  aiSiliconModel: string    // 主力模型，默认 Qwen/Qwen3-8B
  aiApiKey: string          // 智谱开放平台 API Key（兜底平台，仅存本机）
  aiModel: string           // 兜底模型名
  aiAutoEnabled: boolean    // 是否允许后台自动生成管家建议
}

export const presetThemes: ThemePreset[] = [
  { id: 'ember', name: '烬橙', focusColor: '#f0682e', breakColor: '#34a86e', idleColor: '#5a9bd8' },
  { id: 'azure', name: '黛蓝', focusColor: '#5b8ff0', breakColor: '#3fc08d', idleColor: '#9a8cf5' },
  { id: 'celadon', name: '青瓷', focusColor: '#2fb8a6', breakColor: '#f2a154', idleColor: '#7c93b8' },
  // 奖励位沿用 theme-dawn 这个 id，老用户已解锁的状态直接继承
  { id: 'blossom', name: '绯樱', focusColor: '#ef6fa7', breakColor: '#41c4a4', idleColor: '#a78bfa', rewardId: 'theme-dawn' },
]

const THEME_IDS = new Set(presetThemes.map(t => t.id))

const DEFAULT_SETTINGS: Settings = {
  islandOpacity: 0.25,
  islandScale: 1.0,
  islandDisplayMode: 'resident',
  islandEdge: 'top',
  islandEdgeRatio: null,
  islandPeek: false,
  bubbles: defaultBubbleSettings(),
  focusDuration: 25,
  breakDuration: 5,
  colorMode: 'system',
  activeThemeId: 'ember',
  customFocusColor: '',
  idleMottos: [],
  shortcuts: defaultShortcutSettings(),
  tray: defaultTraySettings(),
  notifications: defaultNotificationSettings(),
  autoLaunch: true,
  aiSiliconKey: '',
  aiSiliconModel: 'Qwen/Qwen3-8B',
  aiApiKey: '',
  aiModel: 'glm-4.7-flash',
  aiAutoEnabled: true,
}

/** 浅拷贝会共享嵌套对象，修改设置时会污染默认值 */
function cloneSettings(source: Settings): Settings {
  return {
    ...source,
    shortcuts: { ...source.shortcuts },
    tray: { ...source.tray },
    notifications: { ...source.notifications },
    bubbles: { ...source.bubbles },
  }
}

const settings = ref<Settings>(cloneSettings(DEFAULT_SETTINGS))
let systemSchemeListenerBound = false

function normalizeColorMode(mode: unknown): ColorMode {
  if (mode === 'dark' || mode === 'light' || mode === 'system') return mode
  return 'system'
}

export function resolveColorMode(mode: ColorMode): 'dark' | 'light' {
  if (mode !== 'system') return mode
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'dark'
}

function onSystemSchemeChange() {
  if (settings.value.colorMode === 'system') applyThemeToDOM()
}

function ensureSystemSchemeListener() {
  if (systemSchemeListenerBound) return
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return

  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', onSystemSchemeChange)
  } else if (typeof mq.addListener === 'function') {
    mq.addListener(onSystemSchemeChange)
  }
  systemSchemeListenerBound = true
}

function applyThemeToDOM() {
  // 自定义主题：主色来自取色器，休息/空闲色由派生规则生成
  const colors = settings.value.activeThemeId === CUSTOM_THEME_ID && isValidHex(settings.value.customFocusColor)
    ? deriveThemeColors(settings.value.customFocusColor)
    : presetThemes.find(t => t.id === settings.value.activeThemeId) ?? presetThemes[0]
  const root = document.documentElement
  const resolvedColorMode = resolveColorMode(settings.value.colorMode)
  root.dataset.colorMode = resolvedColorMode
  root.style.colorScheme = resolvedColorMode
  root.style.setProperty('--focus-color', colors.focusColor)
  root.style.setProperty('--break-color', colors.breakColor)
  root.style.setProperty('--idle-color', colors.idleColor)
  root.style.setProperty('--island-opacity', String(1 - settings.value.islandOpacity))
  root.style.setProperty('--island-scale', String(settings.value.islandScale))
}

const store = createPersistedStore({
  file: 'settings.json',
  schemaVersion: 5,
  migrations: { 1: migrateSettingsV1ToV2, 2: migrateSettingsV2ToV3, 3: migrateSettingsV3ToV4, 4: migrateSettingsV4ToV5 },
  snapshot: () => settings.value,
  restore: (data) => {
    if (!data || typeof data !== 'object') throw new Error('settings.json is not an object')
    // 兼容没有版本号的旧文件：补齐 shortcuts / tray / notifications
    const normalized = normalizeSettingsShape(data)
    const parsed = normalized as Partial<Settings>
    const defaults = cloneSettings(DEFAULT_SETTINGS)
    settings.value = {
      ...defaults,
      ...parsed,
      shortcuts: { ...defaults.shortcuts, ...(parsed.shortcuts ?? {}) },
      tray: { ...defaults.tray, ...(parsed.tray ?? {}) },
      notifications: { ...defaults.notifications, ...(parsed.notifications ?? {}) },
      bubbles: { ...defaults.bubbles, ...(parsed.bubbles ?? {}) },
      colorMode: normalizeColorMode(parsed.colorMode),
      // 主题 id 指向已下线的预设时回退默认；自定义主色只接受合法 hex
      activeThemeId: typeof parsed.activeThemeId === 'string'
        && (THEME_IDS.has(parsed.activeThemeId) || parsed.activeThemeId === CUSTOM_THEME_ID)
        ? parsed.activeThemeId
        : DEFAULT_SETTINGS.activeThemeId,
      customFocusColor: typeof parsed.customFocusColor === 'string' && isValidHex(parsed.customFocusColor)
        ? parsed.customFocusColor.toLowerCase()
        : DEFAULT_SETTINGS.customFocusColor,
    }
  },
  syncEvent: 'settings-changed',
})
const loaded = store.loaded

/** 开机自启同步失败的原因，供设置页展示 */
export const autostartError = ref<string | null>(null)

export async function syncAutostart() {
  // 以本地设置为准：开关开着就确保系统里有启动项，关着就确保删掉。
  // 不要反过来用系统注册状态覆盖开关，启动项被清理时会把开关静默关掉。
  // Web 预览 / Vitest 没有 Tauri 运行时，直接跳过，避免无意义的 invoke 噪音。
  if (!isTauri()) return
  // 只有 main 窗口动注册表：panel/bubble 的 useSettings 也会初始化，
  // 三个窗口各 invoke 一次是纯浪费
  if (getCurrentWebviewWindow().label !== 'main') return
  try {
    await invoke('set_autostart', { enabled: settings.value.autoLaunch })
    autostartError.value = null
  } catch (e) {
    autostartError.value = String(e)
  }
}

let initPromise: Promise<void> | null = null

function ensureInitialized() {
  if (!initPromise) initPromise = store.ensureLoaded().then(syncAutostart)
}

watch(() => settings.value.autoLaunch, () => {
  if (!loaded.value || !isTauri()) return
  void syncAutostart()
})

watchEffect(() => {
  if (loaded.value) applyThemeToDOM()
})

const activeTheme = computed(() =>
  presetThemes.find(t => t.id === settings.value.activeThemeId) ?? presetThemes[0]
)

export function useSettings() {
  ensureSystemSchemeListener()
  ensureInitialized()

  return { settings, settingsReady: loaded, ensureLoaded: () => store.ensureLoaded(), activeTheme, applyThemeToDOM, autostartError }
}
