import { describe, expect, it } from 'vitest'
import {
  buildFallbackPlan,
  groupBySegment,
  normalizeDayPlan,
  segmentFromWhen,
  segmentForNow,
  type DayPlan,
  type PlanEntry,
} from '../dayPlan'

describe('segmentFromWhen', () => {
  it('「HH:mm」按小时归段', () => {
    const now = new Date(2026, 10, 6, 15, 0)
    expect(segmentFromWhen('约 21:00', now)).toBe('evening')
    expect(segmentFromWhen('9:30 起', now)).toBe('morning')
    expect(segmentFromWhen('14:00', now)).toBe('afternoon')
  })

  it('「晚上9点」「下午3点」这类口语补成 24 小时制', () => {
    const now = new Date(2026, 10, 6, 15, 0)
    expect(segmentFromWhen('晚上9点', now)).toBe('evening')
    expect(segmentFromWhen('下午3点', now)).toBe('afternoon')
    expect(segmentFromWhen('早上8点', now)).toBe('morning')
    expect(segmentFromWhen('中午12点', now)).toBe('afternoon')
  })

  it('「今天收尾」这类关键词归晚上', () => {
    const now = new Date(2026, 10, 6, 10, 0)
    expect(segmentFromWhen('今天收尾', now)).toBe('evening')
    expect(segmentFromWhen('睡前', now)).toBe('evening')
  })

  it('「现在起」或解析不出来，按当前时刻归段', () => {
    expect(segmentFromWhen('现在起', new Date(2026, 10, 6, 10, 0))).toBe('morning')
    expect(segmentFromWhen('现在起', new Date(2026, 10, 6, 20, 0))).toBe('evening')
    expect(segmentFromWhen('', new Date(2026, 10, 6, 15, 0))).toBe('afternoon')
    expect(segmentFromWhen('随便什么时候', new Date(2026, 10, 6, 15, 0))).toBe('afternoon')
  })

  it('segmentForNow 的三段边界', () => {
    expect(segmentForNow(new Date(2026, 10, 6, 11, 59))).toBe('morning')
    expect(segmentForNow(new Date(2026, 10, 6, 12, 0))).toBe('afternoon')
    expect(segmentForNow(new Date(2026, 10, 6, 17, 59))).toBe('afternoon')
    expect(segmentForNow(new Date(2026, 10, 6, 18, 0))).toBe('evening')
  })
})

describe('buildFallbackPlan', () => {
  const memos = [
    { id: 'm1', title: '高数作业', estimatedPomodoros: 4, pomodoroCount: 1 },
    { id: 'm2', title: '背单词', estimatedPomodoros: 0, pomodoroCount: 0 },
    { id: 'm3', title: '读论文', estimatedPomodoros: 10, pomodoroCount: 0 },
  ]
  const todos = [
    { id: 't1', title: '交实验报告', course: '物理实验' },
    { id: 't2', title: '作业三', course: '线性代数' },
    { id: 't3', title: '排不下的', course: '第三门课' },
  ]

  it('待办在前最多 2 条，小记按顺序补足，合计不超过 8 条', () => {
    const entries = buildFallbackPlan(memos, todos, new Date(2026, 10, 6, 9, 0))
    expect(entries).toHaveLength(5)
    expect(entries[0]).toMatchObject({ source: 'todo', refId: 't1', pomodoros: 1 })
    expect(entries[1]).toMatchObject({ source: 'todo', refId: 't2' })
    expect(entries[2]).toMatchObject({ source: 'memo', refId: 'm1' })
    expect(entries[4]).toMatchObject({ source: 'memo', refId: 'm3' })
  })

  it('番茄数取剩余量并钳制在 1-3，没估过给 1', () => {
    const entries = buildFallbackPlan(memos, [], new Date(2026, 10, 6, 9, 0))
    // m1：估 4 完成 1 → 剩 3；m2：没估 → 1；m3：估 10 → 钳到 3
    expect(entries.map(entry => entry.pomodoros)).toEqual([3, 1, 3])
  })

  it('从当前时段开始按累计番茄数往后填', () => {
    const morning = buildFallbackPlan(memos, [], new Date(2026, 10, 6, 9, 0))
    // 预算 3：m1 剩余 3 个正好占满上午，m2/m3 顺延到下午
    expect(morning.map(entry => entry.segment)).toEqual(['morning', 'afternoon', 'afternoon'])

    const evening = buildFallbackPlan(memos, [], new Date(2026, 10, 6, 20, 0))
    expect(evening.every(entry => entry.segment === 'evening')).toBe(true)
  })

  it('每条都有 id 且未勾选', () => {
    const entries = buildFallbackPlan(memos, todos, new Date(2026, 10, 6, 9, 0))
    for (const entry of entries) {
      expect(entry.id).toBeTruthy()
      expect(entry.done).toBe(false)
      expect(entry.doneAt).toBeNull()
    }
  })
})

describe('normalizeDayPlan', () => {
  const validEntry: PlanEntry = {
    id: 'e1',
    source: 'memo',
    refId: 'm1',
    title: '高数作业',
    segment: 'morning',
    pomodoros: 2,
    done: true,
    doneAt: 1000,
  }
  const validPlan: DayPlan = {
    date: '2026-11-06',
    entries: [validEntry],
    origin: 'model',
    greeting: '上午好',
    createdAt: 1,
    updatedAt: 2,
  }

  it('合法数据原样通过', () => {
    expect(normalizeDayPlan(validPlan)).toEqual(validPlan)
  })

  it('不是对象或日期非法时抛错，交给持久化层备份', () => {
    expect(() => normalizeDayPlan(null)).toThrow()
    expect(() => normalizeDayPlan([])).toThrow()
    expect(() => normalizeDayPlan({ ...validPlan, date: '20261106' })).toThrow()
  })

  it('单条坏了丢弃，整条列表缺省为空', () => {
    const result = normalizeDayPlan({
      ...validPlan,
      entries: [
        validEntry,
        { ...validEntry, id: 'e2', segment: 'noon' },
        { ...validEntry, id: 'e3', source: 'event' },
        { ...validEntry, id: 'e4', title: '' },
        'garbage',
      ],
    })
    expect(result.entries.map(entry => entry.id)).toEqual(['e1'])
    expect(normalizeDayPlan({ ...validPlan, entries: undefined }).entries).toEqual([])
  })

  it('番茄数钳制、非法 origin 退回 fallback、缺省时间戳补当前', () => {
    const result = normalizeDayPlan({
      date: '2026-11-06',
      entries: [{ ...validEntry, done: false, doneAt: null, pomodoros: 99, id: '' }],
    })
    expect(result.origin).toBe('fallback')
    expect(result.greeting).toBeUndefined()
    expect(result.entries[0].pomodoros).toBe(3)
    expect(result.entries[0].id).toBeTruthy()
    expect(result.createdAt).toBeGreaterThan(0)
  })
})

describe('groupBySegment', () => {
  const entry = (over: Partial<PlanEntry>): PlanEntry => ({
    id: over.id ?? 'e',
    source: 'memo',
    refId: 'm',
    title: 't',
    segment: 'morning',
    pomodoros: 1,
    done: false,
    doneAt: null,
    ...over,
  })

  it('按上午/下午/晚上排序，只留有内容的段', () => {
    const groups = groupBySegment([
      entry({ id: 'e1', segment: 'evening' }),
      entry({ id: 'e2', segment: 'morning' }),
      entry({ id: 'e3', segment: 'morning' }),
    ])
    expect(groups.map(group => group.label)).toEqual(['上午', '晚上'])
    expect(groups[0].entries.map(entry => entry.id)).toEqual(['e2', 'e3'])
  })

  it('做完的沉到段尾', () => {
    const groups = groupBySegment([
      entry({ id: 'done1', done: true, doneAt: 1 }),
      entry({ id: 'todo1' }),
      entry({ id: 'done2', done: true, doneAt: 2 }),
    ])
    expect(groups[0].entries.map(entry => entry.id)).toEqual(['todo1', 'done1', 'done2'])
  })
})
