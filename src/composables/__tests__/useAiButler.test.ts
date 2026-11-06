import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CoachContext, CoachMessage, CoachPlan } from '../useAi'
import type { TronTodo } from '../../utils/tronApi'

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

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(async () => {
    throw new Error('测试里不应真的发请求')
  }),
}))

/** 固定「现在」，避免用例之间互相影响 */
const NOW = new Date(2026, 10, 6, 12, 0, 0).getTime()

function localIso(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`
}

function makeTodo(id: string, dueTs: string): TronTodo {
  return {
    id,
    title: `作业 ${id}`,
    course: `课程 ${id}`,
    courseId: 'c1',
    type: 'homework',
    due: dueTs.replace('T', ' ').slice(0, 16),
    dueTs,
    hoursLeft: null,
    overdue: false,
  }
}

function makeCtx(overrides: Partial<CoachContext> = {}): CoachContext {
  return {
    now: '2026-11-06 12:00 周五',
    timeOfDay: '中午',
    minutesToNextEvent: null,
    nextEventTitle: null,
    focusMinutes: 25,
    memos: [
      { id: 'm1', title: '小记一', content: '', pomodoros: 0, estimatedPomodoros: 0, daysSinceUpdate: 1, pinned: false },
      { id: 'm2', title: '小记二', content: '', pomodoros: 0, estimatedPomodoros: 0, daysSinceUpdate: 2, pinned: false },
    ],
    events: [],
    overdueCount: 0,
    todayPomodoros: 0,
    focusMinutesToday: 0,
    completedToday: [],
    recentCoaches: [],
    preference: '',
    userNotes: [],
    dismissed: [],
    todos: [
      { id: 't1', title: '作业 A', course: '数据结构', msLeft: 3600e3, dueLabel: '剩 1.0 小时' },
      { id: 't2', title: '作业 B', course: '操作系统', msLeft: 172800e3, dueLabel: '剩 48.0 小时' },
    ],
    ...overrides,
  }
}

function makePlan(partial: Partial<CoachPlan>): CoachPlan {
  return {
    title: '',
    when: '',
    memoIndex: null,
    memoId: null,
    todoIndex: null,
    todo: null,
    pomodoros: 1,
    reason: '',
    ...partial,
  }
}

function makeMessage(plans: CoachPlan[]): CoachMessage {
  return { greeting: '来了', plans, care: '', closing: '' }
}

describe('selectUrgentTodos', () => {
  beforeEach(() => {
    h.files.clear()
    vi.resetModules()
  })

  it('48 小时内截止和已过期的命中，其余排除', async () => {
    const { selectUrgentTodos } = await import('../useAiButler')
    const todos = [
      makeTodo('a', localIso(NOW + 47 * 3600e3)), // 47 小时后：命中
      makeTodo('b', localIso(NOW + 49 * 3600e3)), // 49 小时后：太远
      makeTodo('c', localIso(NOW - 3600e3)), // 1 小时前：已过期，命中
      makeTodo('d', ''), // 没有截止时间：排除
    ]
    const picked = selectUrgentTodos(todos, NOW)
    expect(picked.map(todo => todo.id)).toEqual(['c', 'a'])
  })

  it('按截止时间升序排列，并按 cap 截断', async () => {
    const { selectUrgentTodos } = await import('../useAiButler')
    const todos = [
      makeTodo('late', localIso(NOW + 40 * 3600e3)),
      makeTodo('soon', localIso(NOW + 2 * 3600e3)),
      makeTodo('mid', localIso(NOW + 20 * 3600e3)),
      makeTodo('overdue', localIso(NOW - 5 * 3600e3)),
    ]
    const picked = selectUrgentTodos(todos, NOW)
    expect(picked.map(todo => todo.id)).toEqual(['overdue', 'soon', 'mid'])

    const capped = selectUrgentTodos(todos, NOW, 2)
    expect(capped.map(todo => todo.id)).toEqual(['overdue', 'soon'])
  })
})

describe('mapCoachPlans', () => {
  beforeEach(() => {
    h.files.clear()
    vi.resetModules()
  })

  it('todoIndex 有效时回填待办快照，标题用待办原始标题', async () => {
    const { mapCoachPlans } = await import('../useAiButler')
    const message = makeMessage([
      makePlan({ title: '模型起的作业名', todoIndex: 1, memoIndex: 1 }),
    ])
    const enriched = mapCoachPlans(message, makeCtx(), [])
    expect(enriched.plans[0]).toMatchObject({
      title: '作业 A',
      memoId: null,
      todo: { id: 't1', course: '数据结构' },
    })
  })

  it('memoIndex 有效时回填小记 id 和真实标题', async () => {
    const { mapCoachPlans } = await import('../useAiButler')
    const message = makeMessage([
      makePlan({ title: '模型起的名字', memoIndex: 2 }),
    ])
    const enriched = mapCoachPlans(message, makeCtx(), [])
    expect(enriched.plans[0]).toMatchObject({ title: '小记二', memoId: 'm2', todo: null })
  })

  it('序号越界一律归 null，不报错也不丢条目', async () => {
    const { mapCoachPlans } = await import('../useAiButler')
    const message = makeMessage([
      makePlan({ title: '越界的待办', todoIndex: 9 }),
      makePlan({ title: '越界的小记', memoIndex: 9 }),
    ])
    const enriched = mapCoachPlans(message, makeCtx(), [])
    expect(enriched.plans).toHaveLength(2)
    expect(enriched.plans[0]).toMatchObject({ title: '越界的待办', todo: null, memoId: null })
    expect(enriched.plans[1]).toMatchObject({ title: '越界的小记', memoId: null })
  })

  it('换掉过的标题不再出现', async () => {
    const { mapCoachPlans } = await import('../useAiButler')
    const message = makeMessage([
      makePlan({ title: '小记一', memoIndex: 1 }),
      makePlan({ title: '小记二', memoIndex: 2 }),
    ])
    const enriched = mapCoachPlans(message, makeCtx(), ['小记一'])
    expect(enriched.plans).toHaveLength(1)
    expect(enriched.plans[0].title).toBe('小记二')
  })
})
