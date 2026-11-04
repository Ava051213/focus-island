import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { TimerPhase, TimerStatus } from '../../timer/machine'

const h = vi.hoisted(() => ({
  invoke: vi.fn(async (..._args: unknown[]): Promise<unknown> => ({ ok: true, errors: [] })),
  listens: [] as Array<{ event: string; cb: (e: { payload: unknown }) => void }>,
  tauri: true,
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: h.invoke,
  isTauri: () => h.tauri,
}))

vi.mock('@tauri-apps/api/event', () => ({
  emitTo: vi.fn(async () => {}),
  listen: vi.fn(async (event: string, cb: (e: { payload: unknown }) => void) => {
    h.listens.push({ event, cb })
    return () => {}
  }),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppData: 'AppData' },
  exists: vi.fn(async () => false),
  readTextFile: vi.fn(async () => ''),
  writeTextFile: vi.fn(async () => {}),
  rename: vi.fn(async () => {}),
  copyFile: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {}),
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({ label: 'panel' }),
}))

vi.mock('@tauri-apps/plugin-autostart', () => ({
  enable: vi.fn(async () => {}),
  disable: vi.fn(async () => {}),
}))

function makeTimer(opts: {
  status?: TimerStatus
  phase?: TimerPhase
  running?: boolean
} = {}) {
  return {
    status: ref<TimerStatus>(opts.status ?? 'idle'),
    phase: ref<TimerPhase>(opts.phase ?? 'focus'),
    running: ref(opts.running ?? false),
    start: vi.fn<(taskId: string | null, taskTitle?: string) => void>(),
    resume: vi.fn<() => void>(),
    pause: vi.fn<() => void>(),
    skipToBreak: vi.fn<() => void>(),
    skipBreak: vi.fn<() => void>(),
  }
}

async function setup(
  shortcuts: { toggleTimer: string; showWindow: string; enabled: boolean },
  timer = makeTimer(),
) {
  vi.resetModules()
  h.invoke.mockClear()
  h.listens.length = 0

  const settingsModule = await import('../useSettings')
  const { settings } = settingsModule.useSettings()
  settings.value.shortcuts = { ...shortcuts }

  const shortcutModule = await import('../useShortcut')
  shortcutModule.shortcutError.value = null
  const api = shortcutModule.useShortcut(timer)
  await Promise.resolve()

  return {
    settings,
    timer,
    applyShortcut: api.applyShortcut,
    shortcutError: shortcutModule.shortcutError,
  }
}

function shortcutListener() {
  return h.listens.find(entry => entry.event === 'shortcut-command')?.cb
}

describe('useShortcut', () => {
  beforeEach(() => {
    h.tauri = true
    h.invoke.mockResolvedValue({ ok: true, errors: [] })
  })

  it('快捷键为空时给出提示并注销旧组合', async () => {
    const { applyShortcut, shortcutError } = await setup({
      enabled: true,
      toggleTimer: '',
      showWindow: '',
    })

    await applyShortcut()

    expect(h.invoke).toHaveBeenLastCalledWith('update_shortcuts', {
      config: { enabled: false, toggleTimer: '', showWindow: '' },
    })
    expect(shortcutError.value).toContain('不能为空')
  })

  it('两个快捷键重复时拒绝注册', async () => {
    const { applyShortcut, shortcutError } = await setup({
      enabled: true,
      toggleTimer: 'Ctrl+Alt+Space',
      showWindow: 'Control+Alt+Space',
    })

    await applyShortcut()

    expect(shortcutError.value).toContain('不能重复')
    expect(h.invoke).toHaveBeenLastCalledWith('update_shortcuts', {
      config: { enabled: false, toggleTimer: '', showWindow: '' },
    })
  })

  it('禁用时把 enabled=false 传给 Rust，不注册任何键', async () => {
    const { applyShortcut, shortcutError } = await setup({
      enabled: false,
      toggleTimer: '',
      showWindow: '',
    })

    await applyShortcut()

    expect(h.invoke).toHaveBeenLastCalledWith('update_shortcuts', {
      config: { enabled: false, toggleTimer: '', showWindow: '' },
    })
    expect(shortcutError.value).toBeNull()
  })

  it('系统占用等注册失败会显示在设置页', async () => {
    h.invoke.mockResolvedValue({
      ok: false,
      errors: [{ action: 'toggle-timer', message: '系统拒绝注册这个快捷键：已被占用' }],
    })

    const { applyShortcut, shortcutError } = await setup({
      enabled: true,
      toggleTimer: 'Ctrl+Alt+Space',
      showWindow: '',
    })

    await applyShortcut()

    expect(shortcutError.value).toContain('已被占用')
  })

  it('快捷键事件复用 useTimer 动作', async () => {
    const timer = makeTimer({ status: 'focus', running: true })
    await setup({ enabled: true, toggleTimer: 'Ctrl+Alt+Space', showWindow: '' }, timer)

    shortcutListener()?.({ payload: 'toggle-timer' })
    expect(timer.pause).toHaveBeenCalledTimes(1)
  })

  it('show-window 打开关闭的清单并请求聚焦，不重新注册快捷键', async () => {
    await setup({ enabled: true, toggleTimer: 'Ctrl+Alt+Space', showWindow: 'Ctrl+Shift+Space' })
    h.invoke.mockClear()
    h.invoke.mockImplementation(async (...args: unknown[]) => {
      if (String(args[0]) === 'is_panel_visible') return false
      return { ok: true, errors: [] }
    })
    const { quickAddRequest } = await import('../useQuickAddFocus')
    const before = quickAddRequest.value

    shortcutListener()?.({ payload: 'show-window' })
    await Promise.resolve()
    await Promise.resolve()

    expect(h.invoke).toHaveBeenCalledWith('is_panel_visible')
    expect(h.invoke).toHaveBeenCalledWith('toggle_panel')
    expect(quickAddRequest.value).toBe(before + 1)
    expect(h.invoke).not.toHaveBeenCalledWith('update_shortcuts', expect.anything())
  })

  it('清单已打开时 show-window 只聚焦，不关闭窗口', async () => {
    await setup({ enabled: true, toggleTimer: 'Ctrl+Alt+Space', showWindow: 'Ctrl+Shift+Space' })
    h.invoke.mockClear()
    h.invoke.mockImplementation(async (...args: unknown[]) => {
      if (String(args[0]) === 'is_panel_visible') return true
      return { ok: true, errors: [] }
    })

    shortcutListener()?.({ payload: 'show-window' })
    await Promise.resolve()
    await Promise.resolve()

    expect(h.invoke).toHaveBeenCalledWith('is_panel_visible')
    expect(h.invoke).not.toHaveBeenCalledWith('toggle_panel')
  })

  it('非 Tauri 环境不调用 invoke', async () => {
    h.tauri = false
    const { applyShortcut } = await setup({
      enabled: true,
      toggleTimer: 'Ctrl+Alt+Space',
      showWindow: '',
    })

    h.invoke.mockClear()
    await applyShortcut()

    expect(h.invoke).not.toHaveBeenCalled()
  })
})
