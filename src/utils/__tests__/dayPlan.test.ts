import { describe, expect, it } from 'vitest'
import {
  applyPlanRefinement,
  buildRulesPlan,
  normalizeDayPlan,
  orderForDisplay,
  planClosing,
  planFactsForDate,
  rulesGreeting,
  type DayPlan,
  type PlanEntry,
  type RulesMemoInput,
} from '../dayPlan'

const NOW = new Date(2026, 10, 6, 12, 0, 0)

function memo(over: Partial<RulesMemoInput> & { id: string }): RulesMemoInput {
  return {
    title: `小记 ${over.id}`,
    isPinned: false,
    pomodoroCount: 0,
    estimatedPomodoros: 0,
    updatedAt: NOW.getTime() - 86400000, // 默认放了 1 天
    ...over,
  }
}

describe('buildRulesPlan', () => {
  it('临近截止的待办在前（最多 3 条），截止文案进 note', () => {
    const todos = [
      { id: 't1', title: '交实验报告', course: '物理实验', dueLabel: '剩 3.5 小时' },
      { id: 't2', title: '作业三', course: '线性代数', dueLabel: '已过期 1 天' },
      { id: 't3', title: '测验', course: '高数', dueLabel: '剩 2 天' },
      { id: 't4', title: '排不下的', course: '第四门课', dueLabel: '剩 5 天' },
    ]
    const entries = buildRulesPlan([], todos, NOW)
    expect(entries).toHaveLength(3)
    expect(entries.map(entry => entry.refId)).toEqual(['t1', 't2', 't3'])
    expect(entries[0]).toMatchObject({ source: 'todo', pomodoros: 1, note: '剩 3.5 小时', course: '物理实验' })
  })

  it('小记打分：置顶 > 放置天数 > 已跑轮数 > 手动顺序', () => {
    const entries = buildRulesPlan([
      memo({ id: 'plain' }),                                   // 2 分
      memo({ id: 'started', pomodoroCount: 2 }),               // 2 + 6 = 8 分
      memo({ id: 'stale', updatedAt: NOW.getTime() - 5 * 86400000 }), // 2 + 10 = 12 分
      memo({ id: 'pinned', isPinned: true, pomodoroCount: 3 }), // 30 + 2 + 9 = 41 分
    ], [], NOW)
    expect(entries.map(entry => entry.refId)).toEqual(['pinned', 'stale', 'started', 'plain'])
  })

  it('同分保持手动顺序，上限 8 条', () => {
    const memos = Array.from({ length: 10 }, (_, i) => memo({ id: `m${i}` }))
    const entries = buildRulesPlan(memos, [], NOW)
    expect(entries).toHaveLength(8)
    expect(entries.map(entry => entry.refId)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'])
  })

  it('番茄数取剩余量并钳制 1-3，没估过给 1', () => {
    const entries = buildRulesPlan([
      memo({ id: 'a', estimatedPomodoros: 10 }),                    // 剩 10 → 3
      memo({ id: 'b', estimatedPomodoros: 4, pomodoroCount: 1 }),   // 剩 3 → 3
      memo({ id: 'c' }),                                            // 没估 → 1
    ], [], NOW)
    expect(entries.map(entry => entry.pomodoros)).toEqual([3, 3, 1])
  })

  it('note 最多两条事实：置顶、放置天数、跑过的轮数、就差最后 1 个', () => {
    const entries = buildRulesPlan([
      memo({ id: 'pinned-stale', isPinned: true, updatedAt: NOW.getTime() - 5 * 86400000 }),
      memo({ id: 'almost', estimatedPomodoros: 4, pomodoroCount: 3 }),
      memo({ id: 'started', pomodoroCount: 2 }),
      memo({ id: 'plain' }),
    ], [], NOW)
    const noteOf = (id: string) => entries.find(entry => entry.refId === id)?.note
    expect(noteOf('pinned-stale')).toBe('置顶的事 · 放了 5 天没动了')
    expect(noteOf('almost')).toBe('已经跑了 3 轮 · 就差最后 1 个番茄')
    expect(noteOf('started')).toBe('已经跑了 2 轮')
    expect(noteOf('plain')).toBeUndefined()
  })
})

describe('buildRulesPlan 的顺延合并', () => {
  const carried: PlanEntry = {
    id: 'old-1',
    source: 'memo',
    refId: 'm1',
    title: '昨天的事',
    pomodoros: 2,
    done: false,
    doneAt: null,
    donePomodoros: 1,
  }

  it('顺延条目排在待办之后、打分小记之前，进度清零并标注', () => {
    const entries = buildRulesPlan(
      [memo({ id: 'm1' }), memo({ id: 'm2' })],
      [{ id: 't1', title: '作业', course: '课', dueLabel: '剩 1 天' }],
      NOW,
      [carried],
    )
    expect(entries.map(entry => entry.refId)).toEqual(['t1', 'm1', 'm2'])
    expect(entries[1]).toMatchObject({
      source: 'memo',
      note: '昨天顺延下来',
      pomodoros: 2,
      done: false,
      doneAt: null,
      donePomodoros: 0,
    })
    expect(entries[1].id).not.toBe('old-1')
  })

  it('顺延过的小记/待办不会被再次捞进列表', () => {
    const todoCarried: PlanEntry = { ...carried, source: 'todo', refId: 't9' }
    const entries = buildRulesPlan(
      [memo({ id: 'm1' })],
      [
        { id: 't9', title: '顺延过的', course: '', dueLabel: '剩 1 天' },
        { id: 't1', title: '新的', course: '', dueLabel: '剩 2 天' },
      ],
      NOW,
      [carried, todoCarried],
    )
    // t9 只以顺延条目的身份出现一次，不会和紧急窗里的 t9 重复
    expect(entries.filter(entry => entry.source === 'todo').map(entry => entry.refId)).toEqual(['t1', 't9'])
    expect(entries.filter(entry => entry.refId === 't9')).toHaveLength(1)
    expect(entries.find(entry => entry.refId === 't9')?.note).toBe('昨天顺延下来')
    expect(entries.filter(entry => entry.refId === 'm1')).toHaveLength(1)
  })
})

describe('planClosing', () => {
  const entry = (id: string, done = false): PlanEntry => ({
    id, source: 'memo', refId: id, title: `事 ${id}`, pomodoros: 1, done, doneAt: done ? 1 : null, donePomodoros: 0,
  })


  it('18 点前不收口', () => {
    expect(planClosing([entry('a')], new Date(2026, 10, 6, 17, 59))).toBeUndefined()
  })

  it('傍晚报剩余：两件全列，三件以上列两件加「等」', () => {
    expect(planClosing([entry('a'), entry('b', true)], new Date(2026, 10, 6, 19, 0)))
      .toBe('今天还剩 1 件：事 a')
    expect(planClosing([entry('a'), entry('b')], new Date(2026, 10, 6, 19, 0)))
      .toBe('今天还剩 2 件：事 a、事 b')
    expect(planClosing([entry('a'), entry('b'), entry('c')], new Date(2026, 10, 6, 19, 0)))
      .toBe('今天还剩 3 件：事 a、事 b 等')
  })

  it('都做完了就不说', () => {
    expect(planClosing([entry('a', true)], new Date(2026, 10, 6, 19, 0))).toBeUndefined()
  })
})

describe('planFactsForDate', () => {
  const done: PlanEntry = { id: 'd', source: 'memo', refId: 'm1', title: '做完的', pomodoros: 1, done: true, doneAt: 1, donePomodoros: 1 }
  const idle: PlanEntry = { id: 'i', source: 'memo', refId: 'm2', title: '拖着的', pomodoros: 1, done: false, doneAt: null, donePomodoros: 0 }

  it('优先取当天的计划', () => {
    const plan: DayPlan = { date: '2026-11-06', entries: [done, idle], origin: 'fallback', createdAt: 1, updatedAt: 1 }
    const facts = planFactsForDate(plan, '2026-11-06')
    expect(facts).toEqual({ planned: 2, finished: 1, finishedTitles: ['做完的'], idleTitles: ['拖着的'] })
  })

  it('跨日补总结时取 previous 里的昨天计划', () => {
    const plan: DayPlan = {
      date: '2026-11-07',
      entries: [],
      origin: 'fallback',
      previous: { date: '2026-11-06', entries: [done, idle] },
      createdAt: 1,
      updatedAt: 1,
    }
    expect(planFactsForDate(plan, '2026-11-06')?.planned).toBe(2)
    expect(planFactsForDate(plan, '2026-11-07')).toBeUndefined()
    expect(planFactsForDate(null, '2026-11-06')).toBeUndefined()
  })
})

describe('rulesGreeting', () => {
  const entry: PlanEntry = {
    id: 'e1', source: 'memo', refId: 'm1', title: '高数作业', pomodoros: 2, done: false, doneAt: null, donePomodoros: 0,
  }

  it('报个数并指向第一条；空列表不说话', () => {
    expect(rulesGreeting([entry], NOW)).toContain('1 件事')
    expect(rulesGreeting([entry], NOW)).toContain('「高数作业」')
    expect(rulesGreeting([], NOW)).toBeUndefined()
  })

  it('按当前时段打招呼', () => {
    expect(rulesGreeting([entry], new Date(2026, 10, 6, 9, 0))).toMatch(/^早上好/)
    expect(rulesGreeting([entry], new Date(2026, 10, 6, 20, 0))).toMatch(/^晚上好/)
  })
})

describe('applyPlanRefinement', () => {
  const entry = (id: string): PlanEntry => ({
    id, source: 'memo', refId: id, title: `标题 ${id}`, pomodoros: 1, done: false, doneAt: null, donePomodoros: 0,
  })

  it('items 先按骨架序号套注解，order 再重排', () => {
    const result = applyPlanRefinement([entry('a'), entry('b')], {
      greeting: '润色过的开场',
      care: '多喝水',
      order: [2, 1],
      items: [{ index: 1, when: '现在起', note: '模型理由' }],
    })
    expect(result.entries.map(item => item.refId)).toEqual(['b', 'a'])
    // index 1 是骨架里的 a，重排后落在第二位
    expect(result.entries[1]).toMatchObject({ refId: 'a', when: '现在起', note: '模型理由' })
    expect(result.greeting).toBe('润色过的开场')
    expect(result.care).toBe('多喝水')
  })

  it('order 不是完整排列时保持规则顺序，注解照常生效', () => {
    const result = applyPlanRefinement([entry('a'), entry('b'), entry('c')], {
      greeting: '',
      care: '',
      order: [3, 1],          // 缺 2
      items: [{ index: 2, note: '第二条的理由' }],
    })
    expect(result.entries.map(item => item.refId)).toEqual(['a', 'b', 'c'])
    expect(result.entries[1].note).toBe('第二条的理由')
  })

  it('重复序号、越界序号、非数组都视为非法', () => {
    for (const bad of [[1, 1], [1, 2, 9], [2], 'not-array']) {
      const result = applyPlanRefinement([entry('a'), entry('b')], { order: bad })
      expect(result.entries.map(item => item.refId)).toEqual(['a', 'b'])
    }
  })

  it('when/note 截断，空值不覆盖，greeting 为空保留规则版', () => {
    const skeleton = [{ ...entry('a'), when: '规则时间', note: '规则理由' }]
    const result = applyPlanRefinement(skeleton, {
      greeting: '',
      care: '',
      order: [],
      items: [{ index: 1, when: '一段特别特别长的时间提示', note: '' }],
    })
    expect(result.entries[0].when).toHaveLength(12)
    expect(result.entries[0].note).toBe('规则理由')
    expect(result.greeting).toBeUndefined()
    expect(result.care).toBeUndefined()
  })

  it('refinement 不是对象时原样返回', () => {
    const skeleton = [entry('a')]
    expect(applyPlanRefinement(skeleton, null)).toEqual({ entries: skeleton })
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
    donePomodoros: 2,
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

  it('donePomodoros 与 previous 都能读回，坏数据容忍', () => {
    const result = normalizeDayPlan({
      date: '2026-11-06',
      entries: [{ ...validEntry, done: false, doneAt: null, donePomodoros: 2 }],
      previous: { date: '2026-11-05', entries: [validEntry], junk: true },
      createdAt: 1,
      updatedAt: 2,
    })
    expect(result.entries[0].donePomodoros).toBe(2)
    expect(result.previous?.date).toBe('2026-11-05')
    expect(result.previous?.entries).toHaveLength(1)
    expect(normalizeDayPlan({ ...validPlan, previous: 'garbage' }).previous).toBeUndefined()
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
    donePomodoros: 0,
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
