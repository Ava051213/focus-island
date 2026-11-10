import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  files: new Map<string, string>(),
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

// 成就状态是模块级单例，每个用例重新加载模块图
async function freshAchievements() {
  vi.resetModules()
  const { useAchievements } = await import('../useAchievements')
  return useAchievements()
}

describe('useAchievements 连续打卡与解锁', () => {
  beforeEach(() => {
    h.files.clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 11, 10, 0, 0)) // 2026-11-11 周三
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('首次打卡：连续 1 天，累计 1 个番茄', async () => {
    const api = await freshAchievements()
    api.recordPomodoro()

    expect(api.state.value.streakDays).toBe(1)
    expect(api.state.value.totalPomodoros).toBe(1)
    expect(api.state.value.lastFocusDate).toBe('2026-11-11')
  })

  it('同一天多次打卡不重复计连续天数', async () => {
    const api = await freshAchievements()
    api.recordPomodoro()
    api.recordPomodoro()
    api.recordPomodoro()

    expect(api.state.value.streakDays).toBe(1)
    expect(api.state.value.totalPomodoros).toBe(3)
  })

  it('隔天打卡连续天数 +1，断签后重新从 1 开始', async () => {
    const api = await freshAchievements()
    api.recordPomodoro()

    vi.setSystemTime(new Date(2026, 10, 12, 9, 0, 0))
    api.recordPomodoro()
    expect(api.state.value.streakDays).toBe(2)

    // 跳过两天再打卡：断签重置
    vi.setSystemTime(new Date(2026, 10, 15, 9, 0, 0))
    api.recordPomodoro()
    expect(api.state.value.streakDays).toBe(1)
  })

  it('累计番茄达标按阈值解锁，且只解锁一次', async () => {
    const api = await freshAchievements()
    for (let i = 0; i < 10; i++) api.recordPomodoro()

    const star1 = api.achievements.value.find(a => a.id === 'star-1')
    expect(star1?.unlockedAt).not.toBeNull()
    expect(star1?.progress).toBe(10)

    // 继续打卡不影响已解锁项的解锁时间
    const unlockedAt = star1?.unlockedAt
    for (let i = 0; i < 5; i++) api.recordPomodoro()
    expect(api.achievements.value.find(a => a.id === 'star-1')?.unlockedAt).toBe(unlockedAt)
    expect(api.achievements.value.find(a => a.id === 'star-2')?.unlockedAt).toBeNull()
  })

  it('连续天数达标解锁对应的连续成就', async () => {
    const api = await freshAchievements()
    for (let day = 0; day < 3; day++) {
      vi.setSystemTime(new Date(2026, 10, 11 + day, 9, 0, 0))
      api.recordPomodoro()
    }

    const streak1 = api.achievements.value.find(a => a.id === 'streak-1')
    expect(streak1?.unlockedAt).not.toBeNull()
    expect(api.unlockedCount.value).toBeGreaterThanOrEqual(1)
  })

  it('晨光者解锁幂等：重复打卡不覆盖解锁时间', async () => {
    const api = await freshAchievements()
    api.recordEarlyBird()
    const first = api.achievements.value.find(a => a.id === 'early-bird')?.unlockedAt
    api.recordEarlyBird()

    const earlyBird = api.achievements.value.find(a => a.id === 'early-bird')
    expect(earlyBird?.unlockedAt).toBe(first)
    expect(api.state.value.earlyBirdCount).toBe(2)
  })
})
