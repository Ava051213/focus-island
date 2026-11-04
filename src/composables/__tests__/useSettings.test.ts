import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_TOGGLE_SHORTCUT } from '../../utils/shortcuts'

const h = vi.hoisted(() => ({
  tauri: true,
  files: new Map<string, string>(),
  enable: vi.fn(async () => {}),
  disable: vi.fn(async () => {}),
}))

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => h.tauri,
  invoke: vi.fn(async () => {}),
}))

vi.mock('@tauri-apps/plugin-autostart', () => ({
  enable: h.enable,
  disable: h.disable,
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppData: 'AppData' },
  exists: vi.fn(async (p: string) => h.files.has(p)),
  readTextFile: vi.fn(async (p: string) => {
    const value = h.files.get(p)
    if (value === undefined) throw new Error('ENOENT')
    return value
  }),
  writeTextFile: vi.fn(async (p: string, data: string) => {
    h.files.set(p, data)
  }),
  rename: vi.fn(async (from: string, to: string) => {
    const value = h.files.get(from)
    if (value === undefined) throw new Error('ENOENT')
    h.files.set(to, value)
    h.files.delete(from)
  }),
  copyFile: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {}),
}))

vi.mock('@tauri-apps/api/event', () => ({
  emitTo: vi.fn(async () => {}),
  listen: vi.fn(async () => () => {}),
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({ label: 'panel' }),
}))

const SETTINGS_FILE = 'focus-island/settings.json'

describe('useSettings 系统集成', () => {
  beforeEach(() => {
    h.tauri = true
    h.files.clear()
    h.enable.mockClear()
    h.disable.mockClear()
    vi.resetModules()
  })

  it('非 Tauri 环境 syncAutostart 不调用系统接口', async () => {
    h.tauri = false
    const { syncAutostart } = await import('../useSettings')

    await syncAutostart()

    expect(h.enable).not.toHaveBeenCalled()
    expect(h.disable).not.toHaveBeenCalled()
  })

  it('Tauri 环境按本地开关启用 / 关闭自启', async () => {
    const { useSettings, syncAutostart } = await import('../useSettings')
    const { settings } = useSettings()

    settings.value.autoLaunch = true
    await syncAutostart()
    expect(h.enable).toHaveBeenCalled()

    settings.value.autoLaunch = false
    await syncAutostart()
    // 设置监听和手动调用都会走 disable，这里只关心它确实被调用
    expect(h.disable).toHaveBeenCalled()
  })

  it('启动时把 v1 settings 迁移成 v2 结构', async () => {
    h.files.set(SETTINGS_FILE, JSON.stringify({
      schemaVersion: 1,
      data: {
        focusDuration: 30,
        shortcutKey: 'Control+Shift+P',
        notificationSound: false,
      },
    }))

    const { useSettings } = await import('../useSettings')
    const { settings, settingsReady } = useSettings()

    await vi.waitFor(() => expect(settingsReady.value).toBe(true))

    expect(settings.value.focusDuration).toBe(30)
    expect(settings.value.shortcuts.toggleTimer).toBe(DEFAULT_TOGGLE_SHORTCUT)
    expect(settings.value.shortcuts.showWindow).toBe('Control+Shift+P')
    expect(settings.value.notifications.sound).toBe(false)
    expect(settings.value.tray.closeToTray).toBe(true)
  })
})
