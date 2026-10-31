import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseQuickEvent, useEvents } from '../useEvents'

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

// 2026-10-31 是周六
const NOW = new Date(2026, 9, 31, 9, 0, 0)

describe('parseQuickEvent', () => {
  it('识别「明天」和标签', () => {
    expect(parseQuickEvent('明天 交水电费 #生活', NOW)).toEqual({
      title: '交水电费',
      at: '2026-11-01',
      tag: 'life',
    })
  })

  it('识别具体时刻', () => {
    expect(parseQuickEvent('今天 14:30 开会 #工作', NOW)).toEqual({
      title: '开会',
      at: '2026-10-31T14:30',
      tag: 'work',
    })
  })

  it('周六说「周五」落到下周五', () => {
    expect(parseQuickEvent('周五 交报告', NOW).at).toBe('2026-11-06')
  })

  it('识别月/日，年份取当年', () => {
    expect(parseQuickEvent('11/15 妈妈生日', NOW)).toEqual({
      title: '妈妈生日',
      at: '2026-11-15',
      tag: 'other',
    })
  })

  it('什么都不写时落在今天，标签兜底为其他', () => {
    expect(parseQuickEvent('随手记一件', NOW)).toEqual({
      title: '随手记一件',
      at: '2026-10-31',
      tag: 'other',
    })
  })

  it('日期词和标题连写也能拆开', () => {
    expect(parseQuickEvent('明天交报告', NOW).title).toBe('交报告')
  })

  it('非法日期不吞掉内容', () => {
    const parsed = parseQuickEvent('99/99 怪东西', NOW)
    expect(parsed.title).toBe('99/99 怪东西')
    expect(parsed.at).toBe('2026-10-31')
  })

  it('「下周三」按下周一开始算，落在 11/4', () => {
    expect(parseQuickEvent('下周三 开会', NOW).at).toBe('2026-11-04')
  })

  it('中文时刻：下午三点', () => {
    expect(parseQuickEvent('下周三下午三点开会', NOW)).toEqual({
      title: '开会',
      at: '2026-11-04T15:00',
      tag: 'other',
    })
  })

  it('中文时刻：上午十点、晚上八点半、中午一点', () => {
    expect(parseQuickEvent('明天上午十点复查牙齿', NOW).at).toBe('2026-11-01T10:00')
    expect(parseQuickEvent('晚上八点半跑步', NOW).at).toBe('2026-10-31T20:30')
    expect(parseQuickEvent('中午一点吃饭', NOW).at).toBe('2026-10-31T13:00')
  })
})

describe('useEvents 排序与分档', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const { events } = useEvents()
    events.value = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('未处理的事件按时间升序，逾期的单独归档', () => {
    const { events, addEvent, upcoming, overdue } = useEvents()
    events.value = []
    addEvent({ title: '第三', at: '2026-11-10' })
    addEvent({ title: '已过期', at: '2026-10-30' })
    addEvent({ title: '第二', at: '2026-11-02' })
    addEvent({ title: '第一', at: '2026-11-01' })

    expect(upcoming.value.map(e => e.title)).toEqual(['第一', '第二', '第三'])
    expect(overdue.value.map(e => e.title)).toEqual(['已过期'])
  })

  it('同一天里全天事件排在有具体时间的之前', () => {
    const { events, addEvent, upcoming } = useEvents()
    events.value = []
    addEvent({ title: '有时间的', at: '2026-11-01T10:00' })
    addEvent({ title: '全天的', at: '2026-11-01' })

    expect(upcoming.value.map(e => e.title)).toEqual(['全天的', '有时间的'])
  })

  it('标记已处理后不再出现在即将发生里', () => {
    const { events, addEvent, toggleHandled, upcoming, handledEvents } = useEvents()
    events.value = []
    const event = addEvent({ title: '处理掉它', at: '2026-11-05' })

    toggleHandled(event!.id)

    expect(upcoming.value).toHaveLength(0)
    expect(handledEvents.value.map(e => e.title)).toEqual(['处理掉它'])
  })

  it('删除后不再返回', () => {
    const { events, addEvent, deleteEvent } = useEvents()
    events.value = []
    const event = addEvent({ title: '待删', at: '2026-11-05' })

    deleteEvent(event!.id)

    expect(events.value).toHaveLength(0)
  })

  it('空标题不会创建事件', () => {
    const { events, addEvent } = useEvents()
    events.value = []

    expect(addEvent({ title: '   ', at: '2026-11-05' })).toBeNull()
    expect(events.value).toHaveLength(0)
  })

  it('withinDays 只取窗口内的', () => {
    const { events, addEvent, withinDays } = useEvents()
    events.value = []
    addEvent({ title: '三天后', at: '2026-11-03' })
    addEvent({ title: '十天后', at: '2026-11-10' })

    expect(withinDays(7).map(e => e.title)).toEqual(['三天后'])
  })
})
