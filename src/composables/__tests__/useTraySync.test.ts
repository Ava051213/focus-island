import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { useTraySync } from '../useTraySync'
import type { TimerPhase, TimerStatus } from '../../timer/machine'

const h = vi.hoisted(() => ({
  invoke: vi.fn(async (..._args: unknown[]) => {}),
  listens: [] as Array<{ event: string; cb: (e: { payload: unknown }) => void }>,
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: h.invoke,
  isTauri: () => true,
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

function makeTimer(opts: {
  status?: TimerStatus
  phase?: TimerPhase
  running?: boolean
  remaining?: number
  title?: string | null
} = {}) {
  return {
    status: ref<TimerStatus>(opts.status ?? 'idle'),
    phase: ref<TimerPhase>(opts.phase ?? 'focus'),
    running: ref(opts.running ?? false),
    remaining: ref(opts.remaining ?? 0),
    activeTaskTitle: ref<string | null>(opts.title ?? null),
    start: vi.fn(),
    resume: vi.fn(),
    pause: vi.fn(),
    skipToBreak: vi.fn(),
    skipBreak: vi.fn(),
  }
}

function trayListener() {
  return h.listens.find(entry => entry.event === 'tray-command')?.cb
}

describe('useTraySync', () => {
  beforeEach(() => {
    h.invoke.mockClear()
    h.listens.length = 0
  })

  it('挂载时把初始计时状态推给 Rust', async () => {
    const timer = makeTimer()
    useTraySync(timer)

    expect(h.invoke).toHaveBeenCalledWith('update_tray_state', {
      state: {
        status: 'idle',
        phase: 'focus',
        running: false,
        remainingSeconds: 0,
        taskTitle: null,
      },
    })
  })

  it('状态变化时重新推送，剩余时间按分钟粒度', async () => {
    const timer = makeTimer()
    useTraySync(timer)

    timer.status.value = 'focus'
    timer.running.value = true
    timer.remaining.value = 25 * 60
    timer.activeTaskTitle.value = '写测试'
    await nextTick()

    expect(h.invoke).toHaveBeenLastCalledWith('update_tray_state', {
      state: {
        status: 'focus',
        phase: 'focus',
        running: true,
        remainingSeconds: 25 * 60,
        taskTitle: '写测试',
      },
    })

    // 同一分钟内的秒数变化不触发新的 IPC
    const callsAfterUpdate = h.invoke.mock.calls.length
    timer.remaining.value = 25 * 60 - 10
    await nextTick()
    expect(h.invoke.mock.calls.length).toBe(callsAfterUpdate)
  })

  it('托盘「开始/暂停」事件复用计时动作', async () => {
    const timer = makeTimer({ status: 'focus', running: true })
    useTraySync(timer)
    await Promise.resolve()

    trayListener()?.({ payload: 'toggle-timer' })
    expect(timer.pause).toHaveBeenCalledTimes(1)
  })

  it('托盘「跳过」事件复用计时动作', async () => {
    const timer = makeTimer({ status: 'focus', running: true })
    useTraySync(timer)
    await Promise.resolve()

    trayListener()?.({ payload: 'skip' })
    expect(timer.skipToBreak).toHaveBeenCalledTimes(1)
    expect(timer.skipBreak).not.toHaveBeenCalled()
  })

  it('关闭到托盘设置变化时同步给 Rust', async () => {
    const { useSettings } = await import('../useSettings')
    const timer = makeTimer()
    useTraySync(timer)
    await Promise.resolve()

    const { settings } = useSettings()
    settings.value.tray.closeToTray = false
    await nextTick()

    expect(h.invoke).toHaveBeenLastCalledWith('set_close_to_tray', { enabled: false })
  })
})
