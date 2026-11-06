import { describe, expect, it } from 'vitest'
import {
  buildFallbackPlan,
  normalizeDayPlan,
  orderForDisplay,
  type DayPlan,
  type PlanEntry,
} from '../dayPlan'

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

  it('待办在前最多 2 条，小记按手动顺序补足，合计不超过 8 条', () => {
    const entries = buildFallbackPlan(memos, todos)
    expect(entries).toHaveLength(5)
    expect(entries[0]).toMatchObject({ source: 'todo', refId: 't1', pomodoros: 1 })
    expect(entries[1]).toMatchObject({ source: 'todo', refId: 't2' })
    expect(entries[2]).toMatchObject({ source: 'memo', refId: 'm1' })
    expect(entries[4]).toMatchObject({ source: 'memo', refId: 'm3' })
  })

  it('番茄数取剩余量并钳制在 1-3，没估过给 1', () => {
    const entries = buildFallbackPlan(memos, [])
    // m1：估 4 完成 1 → 剩 3；m2：没估 → 1；m3：估 10 → 钳到 3
    expect(entries.map(entry => entry.pomodoros)).toEqual([3, 1, 3])
  })

  it('兜底条目没有时间提示，每条都有 id 且未勾选', () => {
    const entries = buildFallbackPlan(memos, todos)
    for (const entry of entries) {
      expect(entry.id).toBeTruthy()
      expect(entry.when).toBeUndefined()
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
    when: '约 9:00',
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
        { ...validEntry, id: 'e2', source: 'event' },
        { ...validEntry, id: 'e3', title: '' },
        'garbage',
      ],
    })
    expect(result.entries.map(entry => entry.id)).toEqual(['e1'])
    expect(normalizeDayPlan({ ...validPlan, entries: undefined }).entries).toEqual([])
  })

  it('旧数据的 segment 字段被忽略，不挡读取', () => {
    const result = normalizeDayPlan({
      ...validPlan,
      entries: [{ ...validEntry, id: 'e-old', segment: 'morning' }],
    })
    expect(result.entries[0]).toMatchObject({ id: 'e-old', when: '约 9:00' })
    expect('segment' in result.entries[0]).toBe(false)
  })

  it('番茄数钳制、非法 origin 退回 fallback、when 截断、缺省时间戳补当前', () => {
    const result = normalizeDayPlan({
      date: '2026-11-06',
      entries: [{
        ...validEntry,
        done: false,
        doneAt: null,
        pomodoros: 99,
        when: '一段特别特别长的时间提示文本',
        id: '',
      }],
    })
    expect(result.origin).toBe('fallback')
    expect(result.greeting).toBeUndefined()
    expect(result.entries[0].pomodoros).toBe(3)
    expect(result.entries[0].when).toHaveLength(12)
    expect(result.entries[0].id).toBeTruthy()
    expect(result.createdAt).toBeGreaterThan(0)
  })
})

describe('orderForDisplay', () => {
  const entry = (over: Partial<PlanEntry>): PlanEntry => ({
    id: over.id ?? 'e',
    source: 'memo',
    refId: 'm',
    title: 't',
    pomodoros: 1,
    done: false,
    doneAt: null,
    ...over,
  })

  it('做完的沉底，其余保持建议先后', () => {
    const ordered = orderForDisplay([
      entry({ id: 'done1', done: true, doneAt: 1 }),
      entry({ id: 'a' }),
      entry({ id: 'done2', done: true, doneAt: 2 }),
      entry({ id: 'b' }),
    ])
    expect(ordered.map(entry => entry.id)).toEqual(['a', 'b', 'done1', 'done2'])
  })
})
