import { ref, computed, watch, watchEffect } from 'vue'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { createPersistedStore } from './persistence'
import {
  defaultNotificationSettings,
  defaultShortcutSettings,
  defaultTraySettings,
  migrateSettingsV1ToV2,
  normalizeSettingsShape,
  type NotificationSettings,
  type ShortcutSettings,
  type TraySettings,
} from '../utils/settingsMigration'

export interface ThemePreset {
  id: string
  name: string
  focusColor: string
  breakColor: string
  idleColor: string
  alertColor: string
  /** 需要达成本周目标才能使用的奖励主题 */
  rewardId?: string
}

export type ColorMode = 'dark' | 'light' | 'system'

export type IslandDisplayMode = 'resident' | 'dock'

export interface Settings {
  islandOpacity: number      // 透明度 0~0.7，值越大越透明，CSS alpha = 1 - value
  islandScale: number        // 灵动岛缩放比例 0.5~1.5
  islandDisplayMode: IslandDisplayMode  // 灵动岛显示方式：常驻 / 边缘停靠
  islandXRatio: number | null            // 顶部水平位置比例 0~1，null 表示居中
  focusDuration: number
  breakDuration: number
  colorMode: ColorMode
  activeThemeId: string
  idleMottos: string[]       // 空闲时轮播的激励语，空数组则用内置默认
  shortcuts: ShortcutSettings      // 全局快捷键（开始/暂停、打开清单）
  tray: TraySettings               // 关闭窗口时隐藏到托盘
  notifications: NotificationSettings // 系统通知开关与声音
  hideOnFullscreen: boolean // 前台全屏（游戏/视频/演示）时自动把岛藏起来
  autoLaunch: boolean       // 开机自动启动
  aiSiliconKey: string      // 硅基流动 API Key（主力平台，仅存本机）
  aiSiliconModel: string    // 主力模型，默认 Qwen/Qwen3-8B
  aiApiKey: string          // 智谱开放平台 API Key（兜底平台，仅存本机）
  aiModel: string           // 兜底模型名
  aiAutoEnabled: boolean    // 是否允许后台自动生成管家建议
}

export const presetThemes: ThemePreset[] = [
  { id: 'classic', name: '经典橙红', focusColor: '#e85d3a', breakColor: '#3a9e6e', idleColor: '#4a8fd4', alertColor: '#e8a23a' },
  { id: 'ocean', name: '海洋蓝绿', focusColor: '#2d8cf0', breakColor: '#36b37e', idleColor: '#6b8eb2', alertColor: '#f5a623' },
  { id: 'lavender', name: '薰衣草紫', focusColor: '#9b6dff', breakColor: '#4ecdc4', idleColor: '#7c8ba1', alertColor: '#f7b731' },
  { id: 'forest', name: '森林深绿', focusColor: '#27ae60', breakColor: '#3498db', idleColor: '#8e9aaf', alertColor: '#e67e22' },
  { id: 'cyber', name: '赛博朋克', focusColor: '#ff6b9d', breakColor: '#00d2d3', idleColor: '#a29bfe', alertColor: '#feca57' },
  { id: 'dawn', name: '晨光', focusColor: '#ff8a4c', breakColor: '#5ac8a8', idleColor: '#f5c26b', alertColor: '#e06b8b', rewardId: 'theme-dawn' },
]

const DEFAULT_SETTINGS: Settings = {
  islandOpacity: 0.25,
  islandScale: 1.0,
  islandDisplayMode: 'resident',
  islandXRatio: null,
  focusDuration: 25,
  breakDuration: 5,
  colorMode: 'system',
  activeThemeId: 'classic',
  idleMottos: [],
  shortcuts: defaultShortcutSettings(),
  tray: defaultTraySettings(),
  notifications: defaultNotificationSettings(),
  hideOnFullscreen: true,
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
  const theme = presetThemes.find(t => t.id === settings.value.activeThemeId) ?? presetThemes[0]
  const root = document.documentElement
  const resolvedColorMode = resolveColorMode(settings.value.colorMode)
  root.dataset.colorMode = resolvedColorMode
  root.style.colorScheme = resolvedColorMode
  root.style.setProperty('--focus-color', theme.focusColor)
  root.style.setProperty('--break-color', theme.breakColor)
  root.style.setProperty('--idle-color', theme.idleColor)
  root.style.setProperty('--alert-color', theme.alertColor)
  root.style.setProperty('--island-opacity', String(1 - settings.value.islandOpacity))
  root.style.setProperty('--island-scale', String(settings.value.islandScale))
}

const store = createPersistedStore({
  file: 'settings.json',
  schemaVersion: 2,
  migrations: { 1: migrateSettingsV1ToV2 },
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
      colorMode: normalizeColorMode(parsed.colorMode),
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

  return { settings, settingsReady: loaded, activeTheme, applyThemeToDOM, autostartError }
}
