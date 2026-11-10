import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toLocalDateStr } from '../../utils/date'

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

import { getWeekStart } from '../useWeeklyGoals'

// 奖励状态是模块级单例，每个用例重新加载模块图
async function freshRewards() {
  vi.resetModules()
  const { useRewardUnlocks } = await import('../useWeeklyGoals')
  return useRewardUnlocks()
}

describe('getWeekStart 周一起点', () => {
  it('周中返回本周一', () => {
    // 2026-11-11 是周三
    expect(toLocalDateStr(getWeekStart(new Date(2026, 10, 11)))).toBe('2026-11-09')
  })

  it('周一返回当天', () => {
    expect(toLocalDateStr(getWeekStart(new Date(2026, 10, 9)))).toBe('2026-11-09')
  })

  it('周日回到六天前的周一', () => {
    expect(toLocalDateStr(getWeekStart(new Date(2026, 10, 15)))).toBe('2026-11-09')
  })

  it('跨年正确：2027-01-01（周五）落到 2026-12-28', () => {
    expect(toLocalDateStr(getWeekStart(new Date(2027, 0, 1)))).toBe('2026-12-28')
  })

  it('跨月正确：2026-03-01（周日）落到 2026-02-23', () => {
    expect(toLocalDateStr(getWeekStart(new Date(2026, 2, 1)))).toBe('2026-02-23')
  })
})

describe('useRewardUnlocks 恢复与校验', () => {
  beforeEach(() => {
    h.files.clear()
  })

  it('读取已解锁奖励，过滤掉不认识的奖励 id', async () => {
    h.files.set('focus-island/weekly-goals.json', JSON.stringify({
      weekStart: '2026-11-09',
      completed: { pomodoros: 1764883200000 },
      unlockedRewards: ['theme-dawn', 'bogus-reward', 'mottos-gentle'],
    }))

    const { unlockedRewards } = await freshRewards()
    await vi.waitFor(() => expect(unlockedRewards.value).toEqual(['theme-dawn', 'mottos-gentle']))
  })

  it('没有存档时为空', async () => {
    const { unlockedRewards } = await freshRewards()
    await vi.waitFor(() => expect(unlockedRewards.value).toEqual([]))
  })
})
