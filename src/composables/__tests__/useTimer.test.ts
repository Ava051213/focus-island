import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppData: 'AppData' },
  exists: vi.fn(async () => false),
  readTextFile: vi.fn(async () => ''),
  writeTextFile: vi.fn(async () => {}),
  rename: vi.fn(async () => {}),
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

const FOCUS_SECS = 25 * 60
const BREAK_SECS = 5 * 60

// useTimer 的状态全是模块级单例，每个用例重新加载模块图才能拿到干净状态。
async function freshTimer() {
  vi.resetModules()
  const { useTimer } = await import('../useTimer')
  return useTimer()
}

describe('useTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('start 后进入 focus 阶段并开始倒计时', async () => {
    const t = await freshTimer()

    t.start('task-1', '写测试')

    expect(t.phase.value).toBe('focus')
    expect(t.running.value).toBe(true)
    expect(t.remaining.value).toBe(FOCUS_SECS)
    expect(t.totalDuration.value).toBe(FOCUS_SECS)
    expect(t.activeTaskId.value).toBe('task-1')
    expect(t.activeTaskTitle.value).toBe('写测试')
    expect(t.pendingNotification.value).toBeNull()
  })

  it('专注走完自动停止并挂起 focus-done 通知，不自动切阶段', async () => {
    const t = await freshTimer()
    t.start('task-1')

    await vi.advanceTimersByTimeAsync(FOCUS_SECS * 1000)

    expect(t.remaining.value).toBe(0)
    expect(t.running.value).toBe(false)
    expect(t.pendingNotification.value).toBe('focus-done')
    // 等用户点通知，阶段此时仍是 focus
    expect(t.phase.value).toBe('focus')
  })

  it('暂停后剩余时间不再减少', async () => {
    const t = await freshTimer()
    t.start('task-1')

    await vi.advanceTimersByTimeAsync(10 * 1000)
    t.pause()
    const frozen = t.remaining.value

    await vi.advanceTimersByTimeAsync(60 * 1000)

    expect(t.running.value).toBe(false)
    expect(t.remaining.value).toBe(frozen)
    expect(t.remaining.value).toBeLessThan(FOCUS_SECS)
  })

  it('resume 从暂停处继续，不重置时长', async () => {
    const t = await freshTimer()
    t.start('task-1')

    await vi.advanceTimersByTimeAsync(30 * 1000)
    t.pause()
    const frozen = t.remaining.value
    t.resume()

    expect(t.running.value).toBe(true)
    expect(t.remaining.value).toBe(frozen)

    await vi.advanceTimersByTimeAsync(5 * 1000)
    expect(t.remaining.value).toBe(frozen - 5)
  })

  it('confirmNotification 在 focus-done 后进入 break 并重新跑起来', async () => {
    const t = await freshTimer()
    t.start('task-1')
    await vi.advanceTimersByTimeAsync(FOCUS_SECS * 1000)

    t.confirmNotification()

    expect(t.phase.value).toBe('break')
    expect(t.remaining.value).toBe(BREAK_SECS)
    expect(t.totalDuration.value).toBe(BREAK_SECS)
    expect(t.running.value).toBe(true)
    expect(t.pendingNotification.value).toBeNull()
    // 休息阶段仍保留任务归属，便于结束后继续累计
    expect(t.activeTaskId.value).toBe('task-1')
  })

  it('extendNotification 在 focus-done 后重开一轮专注而不是去休息', async () => {
    const t = await freshTimer()
    t.start('task-1')
    await vi.advanceTimersByTimeAsync(FOCUS_SECS * 1000)

    t.extendNotification()

    expect(t.phase.value).toBe('focus')
    expect(t.remaining.value).toBe(FOCUS_SECS)
    expect(t.running.value).toBe(true)
    expect(t.pendingNotification.value).toBeNull()
  })

  it('dismissNotification 清空任务与计时，回到初始状态', async () => {
    const t = await freshTimer()
    t.start('task-1', '写测试')
    await vi.advanceTimersByTimeAsync(FOCUS_SECS * 1000)

    t.dismissNotification()

    expect(t.pendingNotification.value).toBeNull()
    expect(t.running.value).toBe(false)
    expect(t.phase.value).toBe('focus')
    expect(t.remaining.value).toBe(FOCUS_SECS)
    expect(t.activeTaskId.value).toBeNull()
    expect(t.activeTaskTitle.value).toBeNull()
  })

  it('skipToBreak 直接跳到休息阶段', async () => {
    const t = await freshTimer()
    t.start('task-1')

    t.skipToBreak()

    expect(t.phase.value).toBe('break')
    expect(t.remaining.value).toBe(BREAK_SECS)
    expect(t.running.value).toBe(true)
  })

  it('abandon 放弃本轮并清空任务归属', async () => {
    const t = await freshTimer()
    t.start('task-1', '写测试')
    await vi.advanceTimersByTimeAsync(60 * 1000)

    t.abandon()

    expect(t.phase.value).toBe('focus')
    expect(t.running.value).toBe(false)
    expect(t.remaining.value).toBe(FOCUS_SECS)
    expect(t.activeTaskId.value).toBeNull()
    expect(t.focusStartedAt.value).toBeNull()
  })

  it('onPhaseDoneCallback 在阶段结束时可拿到当时的阶段与任务', async () => {
    const t = await freshTimer()
    const seen: Array<[string, string | null]> = []
    t.onPhaseDoneCallback((phase, taskId) => seen.push([phase, taskId]))

    t.start('task-9')
    await vi.advanceTimersByTimeAsync(FOCUS_SECS * 1000)

    expect(seen).toEqual([['focus', 'task-9']])
  })
})
