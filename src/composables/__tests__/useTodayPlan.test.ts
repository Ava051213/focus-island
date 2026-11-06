import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CoachMessage } from '../useAi'

const h = vi.hoisted(() => ({
  files: new Map<string, string>(),
  tronTodos: [] as Array<Record<string, unknown>>,
  configured: { value: false },
  coachToday: vi.fn(),
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

vi.mock('../../utils/tronApi', () => ({
  fetchTronTodos: vi.fn(async () => h.tronTodos),
  TronTodosError: class TronTodosError extends Error {
    constructor(_kind: string, message: string) {
      super(message)
      this.name = 'TronTodosError'
    }
  },
}))

vi.mock('../useAi', () => ({
  useAi: () => ({ configured: h.configured, coachToday: h.coachToday }),
}))

function seedMemo(id: string, title: string, estimatedPomodoros = 0): Record<string, unknown> {
  return {
    id,
    title,
    content: '',
    categoryId: '',
    isPinned: false,
    pomodoroCount: 0,
    estimatedPomodoros,
    createdAt: 1,
    updatedAt: 1,
  }
}

function makeTodo(id: string, dueTs = ''): Record<string, unknown> {
  return {
    id,
    title: `作业 ${id}`,
    course: '课程',
    courseId: 'c1',
    type: 'homework',
    due: '',
    dueTs,
    hoursLeft: null,
    overdue: false,
  }
}

function coachPlan(over: Partial<CoachMessage['plans'][number]>): CoachMessage['plans'][number] {
  return {
    title: '未命名',
    when: '现在起',
    memoIndex: null,
    memoId: null,
    todoIndex: null,
    todo: null,
    pomodoros: 1,
    reason: '',
    ...over,
  }
}

/** 让异步加载、生成链和 0ms 定时器都跑完 */
async function settle() {
  for (let i = 0; i < 6; i++) await Promise.resolve()
  await vi.advanceTimersByTimeAsync(0)
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

/** 持久化写入有 300ms 防抖，读完文件前先冲掉 */
async function flushWrite() {
  await vi.advanceTimersByTimeAsync(400)
}

async function fresh() {
  vi.resetModules()
  const [planMod, memosMod, tronMod, eventsMod] = await Promise.all([
    import('../useTodayPlan'),
    import('../useMemos'),
    import('../useTronTodos'),
    import('../useEvents'),
  ])
  const api = planMod.useTodayPlan()
  // 各 store 是模块级单例，先触发加载，文件里的数据才进得了内存
  memosMod.useMemos()
  tronMod.useTronTodos()
  eventsMod.useEvents()
  await settle()
  return { api }
}

function readPlanFile(): { schemaVersion: number; data: Record<string, unknown> } {
  const raw = h.files.get('focus-island/today-plan.json')
  expect(raw).toBeTruthy()
  return JSON.parse(raw!)
}

describe('useTodayPlan', () => {
  beforeEach(() => {
    h.files.clear()
    h.tronTodos = []
    h.configured.value = false
    h.coachToday.mockReset()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 6, 12, 0, 0))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('没 Key 时本地兜底生成并落盘', async () => {
    h.files.set('focus-island/memos.json', JSON.stringify([seedMemo('m1', '高数作业', 4), seedMemo('m2', '背单词')]))
    h.tronTodos = [makeTodo('t1', '2026-11-07T23:59:00')]
    const { api } = await fresh()

    await api.ensureTodayPlan()

    expect(api.plan.value).not.toBeNull()
    expect(api.plan.value!.origin).toBe('fallback')
    expect(api.plan.value!.date).toBe('2026-11-06')
    expect(api.plan.value!.entries[0]).toMatchObject({ source: 'todo', refId: 't1' })
    expect(api.plan.value!.entries[1]).toMatchObject({ source: 'memo', refId: 'm1', pomodoros: 3 })
    // 中午 12 点起排：待办和小记进下午，剩余的顺延晚上
    expect(api.plan.value!.entries.map(entry => entry.segment)).toEqual(['afternoon', 'afternoon', 'evening'])

    await flushWrite()
    const file = readPlanFile()
    expect(file.schemaVersion).toBe(1)
    expect(file.data.entries).toHaveLength(3)
  })

  it('当天已有安排时 ensure 不重排，保持稳定不漂移', async () => {
    h.files.set('focus-island/memos.json', JSON.stringify([seedMemo('m1', '高数作业')]))
    h.configured.value = true
    h.coachToday.mockResolvedValue({
      greeting: '早上好呀',
      care: '记得喝水',
      closing: '',
      plans: [coachPlan({ title: '高数作业', when: '约 9:00', memoIndex: 1, pomodoros: 2, reason: '先攻高数' })],
    })
    const { api } = await fresh()

    await api.ensureTodayPlan()
    const first = api.plan.value!
    expect(h.coachToday).toHaveBeenCalledTimes(1)

    await api.ensureTodayPlan()
    expect(h.coachToday).toHaveBeenCalledTimes(1)
    expect(api.plan.value).toBe(first)
  })

  it('模型路径：序号映射回真实小记，when 归段，映射不到的丢弃', async () => {
    h.files.set('focus-island/memos.json', JSON.stringify([seedMemo('m1', '高数作业'), seedMemo('m2', '背单词')]))
    h.configured.value = true
    h.coachToday.mockResolvedValue({
      greeting: '早上好呀',
      care: '记得喝水',
      closing: '',
      plans: [
        coachPlan({ title: '高数作业', when: '约 9:00', memoIndex: 1, pomodoros: 2, reason: '先攻高数' }),
        coachPlan({ title: '背单词', when: '晚上9点', memoIndex: 2, pomodoros: 1, reason: '睡前过一遍' }),
        coachPlan({ title: '编造的事', when: '现在起', memoIndex: 99, pomodoros: 1, reason: 'r' }),
      ],
    })
    const { api } = await fresh()

    await api.ensureTodayPlan()

    const plan = api.plan.value!
    expect(plan.origin).toBe('model')
    expect(plan.greeting).toBe('早上好呀')
    expect(plan.care).toBe('记得喝水')
    expect(plan.entries).toHaveLength(2)
    expect(plan.entries[0]).toMatchObject({ source: 'memo', refId: 'm1', segment: 'morning', pomodoros: 2 })
    expect(plan.entries[1]).toMatchObject({ source: 'memo', refId: 'm2', segment: 'evening' })
  })

  it('模型请求失败时退回本地兜底，不抛错', async () => {
    h.files.set('focus-island/memos.json', JSON.stringify([seedMemo('m1', '高数作业')]))
    h.configured.value = true
    h.coachToday.mockRejectedValue(new Error('网络炸了'))
    const { api } = await fresh()

    await api.ensureTodayPlan()

    expect(api.plan.value!.origin).toBe('fallback')
    expect(api.plan.value!.entries.map(entry => entry.refId)).toEqual(['m1'])
  })

  it('勾选与移除都落盘', async () => {
    h.files.set('focus-island/memos.json', JSON.stringify([seedMemo('m1', '高数作业'), seedMemo('m2', '背单词')]))
    const { api } = await fresh()
    await api.ensureTodayPlan()
    const [first, second] = api.plan.value!.entries

    api.toggleEntryDone(first.id)
    expect(api.plan.value!.entries[0].done).toBe(true)
    expect(api.plan.value!.entries[0].doneAt).toBeGreaterThan(0)

    api.removeEntry(second.id)
    expect(api.plan.value!.entries.map(entry => entry.id)).toEqual([first.id])

    await flushWrite()
    const data = readPlanFile().data as { entries: Array<{ id: string; done: boolean }> }
    expect(data.entries).toHaveLength(1)
    expect(data.entries[0].done).toBe(true)
  })

  it('面板开着跨零点，安排自动重排成新的一天', async () => {
    h.files.set('focus-island/memos.json', JSON.stringify([seedMemo('m1', '高数作业')]))
    const { api } = await fresh()
    await api.ensureTodayPlan()
    expect(api.plan.value!.date).toBe('2026-11-06')

    vi.setSystemTime(new Date(2026, 10, 7, 8, 0, 0))
    // eventsNow 的分钟时钟走一格，日期字符串变化触发跨日重排
    await vi.advanceTimersByTimeAsync(60_000)
    await settle()

    expect(api.plan.value!.date).toBe('2026-11-07')
  })
})
