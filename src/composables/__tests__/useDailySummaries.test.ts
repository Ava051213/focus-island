import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  rename: vi.fn(async (from: string, to: string) => {
    const value = h.files.get(from)
    if (value === undefined) throw new Error('ENOENT')
    h.files.set(to, value)
    h.files.delete(from)
  }),
}))

vi.mock('@tauri-apps/api/event', () => ({
  emitTo: vi.fn(async () => {}),
  listen: vi.fn(async () => () => {}),
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({ label: 'panel' }),
}))

const SUMMARY_FILE = 'focus-island/daily-summaries.json'

function makeSummary(date: string, pomodoros = 1) {
  return {
    date,
    pomodoros,
    focusMinutes: pomodoros * 25,
    completedMemos: [],
    summary: `总结 ${date}`,
    tomorrow: '明天继续',
    createdAt: Date.UTC(2026, 10, 4),
  }
}

describe('useDailySummaries', () => {
  beforeEach(() => {
    h.files.clear()
    vi.resetModules()
  })

  it('读取时过滤非法条目，只保留最近 30 天', async () => {
    const list = Array.from({ length: 33 }, (_, index) => {
      const day = String(index + 1).padStart(2, '0')
      return makeSummary(`2026-08-${day}`)
    })
    list.push({ date: 123, summary: '坏数据' } as never)

    h.files.set(SUMMARY_FILE, JSON.stringify(list))

    const { useDailySummaries } = await import('../useDailySummaries')
    const { summaries, latest, loaded } = useDailySummaries()

    await vi.waitFor(() => expect(loaded.value).toBe(true))

    expect(summaries.value).toHaveLength(30)
    expect(summaries.value[0].date).toBe('2026-08-04')
    expect(latest.value?.date).toBe('2026-08-33')
    expect(summaries.value.every(item => typeof item.summary === 'string')).toBe(true)
  })

  it('同一天再次保存会覆盖旧总结，不重复累计', async () => {
    const { useDailySummaries } = await import('../useDailySummaries')
    const { summaries, save, loaded } = useDailySummaries()

    await vi.waitFor(() => expect(loaded.value).toBe(true))

    save(makeSummary('2026-11-04', 3))
    save({ ...makeSummary('2026-11-04', 5), summary: '更新后的总结' })

    expect(summaries.value.filter(item => item.date === '2026-11-04')).toHaveLength(1)
    expect(summaries.value[0].summary).toBe('更新后的总结')
    expect(summaries.value[0].pomodoros).toBe(5)
  })

  it('latest 返回日期最新的一条', async () => {
    const { useDailySummaries } = await import('../useDailySummaries')
    const { latest, save, loaded } = useDailySummaries()

    await vi.waitFor(() => expect(loaded.value).toBe(true))

    save(makeSummary('2026-11-01', 2))
    save(makeSummary('2026-11-03', 4))
    save(makeSummary('2026-11-02', 3))

    expect(latest.value?.date).toBe('2026-11-03')
    expect(latest.value?.pomodoros).toBe(4)
  })
})
