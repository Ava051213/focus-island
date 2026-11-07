import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  files: new Map<string, string>(),
  tronTodos: [] as Array<Record<string, unknown>>,
  configured: { value: false },
  refinePlan: vi.fn(),
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
  useAi: () => ({ configured: h.configured, refinePlan: h.refinePlan }),
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
    h.refinePlan.mockReset()
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

    await flushWrite()
    const file = readPlanFile()
    expect(file.schemaVersion).toBe(1)
    expect(file.data.entries).toHaveLength(3)
  })

  it('当天已有安排时 ensure 不重排，保持稳定不漂移', async () => {
    h.files.set('focus-island/memos.json', JSON.stringify([seedMemo('m1', '高数作业')]))
    h.configured.value = true
    h.refinePlan.mockResolvedValue({ greeting: '润色过的开场', care: '', order: [], items: [] })
    const { api } = await fresh()

    await api.ensureTodayPlan()
    const first = api.plan.value!
    expect(h.refinePlan).toHaveBeenCalledTimes(1)

    await api.ensureTodayPlan()
    expect(h.refinePlan).toHaveBeenCalledTimes(1)
    expect(api.plan.value).toBe(first)
  })

  it('模型润色：重排与注解套到规则骨架上，开场白与提醒被采纳', async () => {
    h.files.set('focus-island/memos.json', JSON.stringify([seedMemo('m1', '高数作业'), seedMemo('m2', '背单词')]))
    h.configured.value = true
    h.refinePlan.mockResolvedValue({
      greeting: '润色过的开场',
      care: '记得喝水',
      order: [2, 1],
      items: [{ index: 1, when: '现在起', note: '模型理由' }],
    })
    const { api } = await fresh()

    await api.ensureTodayPlan()

    const plan = api.plan.value!
    expect(plan.origin).toBe('model')
    expect(plan.greeting).toBe('润色过的开场')
    expect(plan.care).toBe('记得喝水')
    expect(plan.entries).toHaveLength(2)
    // 骨架顺序 [m1, m2]，order [2,1] 换位；index 1 是骨架里的 m1，重排后在第二位
    expect(plan.entries[0]).toMatchObject({ source: 'memo', refId: 'm2' })
    expect(plan.entries[1]).toMatchObject({ refId: 'm1', when: '现在起', note: '模型理由' })
  })

  it('模型请求失败时保持规则结果，不抛错', async () => {
    h.files.set('focus-island/memos.json', JSON.stringify([seedMemo('m1', '高数作业'), seedMemo('m2', '背单词')]))
    h.configured.value = true
    h.refinePlan.mockRejectedValue(new Error('网络炸了'))
    const { api } = await fresh()

    await api.ensureTodayPlan()

    expect(api.plan.value!.origin).toBe('fallback')
    expect(api.plan.value!.entries.map(entry => entry.refId)).toEqual(['m1', 'm2'])
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

  it('面板开着跨零点：重排新的一天、顺延没做完的、存下 previous', async () => {
    h.files.set('focus-island/memos.json', JSON.stringify([seedMemo('m1', '高数作业')]))
    const { api } = await fresh()
    await api.ensureTodayPlan()
    expect(api.plan.value!.date).toBe('2026-11-06')

    vi.setSystemTime(new Date(2026, 10, 7, 8, 0, 0))
    // eventsNow 的分钟时钟走一格，日期字符串变化触发跨日重排
    await vi.advanceTimersByTimeAsync(60_000)
    await settle()

    expect(api.plan.value!.date).toBe('2026-11-07')
    expect(api.plan.value!.previous?.date).toBe('2026-11-06')
    // m1 还在进行中，顺延到今天且标注
    expect(api.plan.value!.entries[0]).toMatchObject({ refId: 'm1', note: '昨天顺延下来', donePomodoros: 0 })
  })

  it('moveEntry 置顶与沉底，做完的不可移', async () => {
    h.files.set('focus-island/memos.json', JSON.stringify([
      seedMemo('m1', '第一件'),
      seedMemo('m2', '第二件'),
      seedMemo('m3', '第三件'),
    ]))
    const { api } = await fresh()
    await api.ensureTodayPlan()
    expect(api.plan.value!.entries.map(entry => entry.refId)).toEqual(['m1', 'm2', 'm3'])

    api.moveEntry(api.plan.value!.entries[0].id, 'bottom')
    expect(api.plan.value!.entries.map(entry => entry.refId)).toEqual(['m2', 'm3', 'm1'])

    const m1Entry = api.plan.value!.entries.find(entry => entry.refId === 'm1')!
    api.moveEntry(m1Entry.id, 'top')
    expect(api.plan.value!.entries.map(entry => entry.refId)).toEqual(['m1', 'm2', 'm3'])

    // 做完的条目位置不该被移动（沉底规则管它）
    api.toggleEntryDone(api.plan.value!.entries[1].id)
    const doneEntry = api.plan.value!.entries.find(entry => entry.done)!
    api.moveEntry(doneEntry.id, 'top')
    expect(api.plan.value!.entries.find(entry => entry.id === doneEntry.id)?.done).toBe(true)
    expect(api.plan.value!.entries[0].done).toBe(false)
  })

  it('完成番茄推进条目，满额自动勾掉', async () => {
    // est 1 → 计划 1 个番茄，推 1 次就该自动勾掉
    h.files.set('focus-island/memos.json', JSON.stringify([seedMemo('m1', '高数作业', 1)]))
    const { api } = await fresh()
    await api.ensureTodayPlan()
    const entry = api.plan.value!.entries.find(item => item.refId === 'm1')!
    expect(entry.donePomodoros).toBe(0)

    api.advanceEntry('m1')

    const after = api.plan.value!.entries.find(item => item.refId === 'm1')!
    expect(after.donePomodoros).toBe(1)
    expect(after.done).toBe(true)
    expect(after.doneAt).toBeGreaterThan(0)
    // 再推进没有未完成条目可推，不报错
    api.advanceEntry('m1')
    api.advanceEntry('不存在的自增不炸')
    expect(api.plan.value!.entries.find(item => item.refId === 'm1')!.donePomodoros).toBe(1)
  })

  it('紧急窗内的新待办插队进今天的安排，且不重复插', async () => {
    h.files.set('focus-island/memos.json', JSON.stringify([seedMemo('m1', '高数作业')]))
    const { api } = await fresh()
    await api.ensureTodayPlan()
    expect(api.plan.value!.entries.some(entry => entry.source === 'todo')).toBe(false)

    // tron 服务这时吐出一条紧急作业
    h.tronTodos = [makeTodo('t-new', '2026-11-06T23:59:00')]
    await fresh2()
    await settle()

    const todoEntries = api.plan.value!.entries.filter(entry => entry.source === 'todo')
    expect(todoEntries).toHaveLength(1)
    expect(todoEntries[0]).toMatchObject({ refId: 't-new' })
    expect(todoEntries[0].note).toContain('新进来的截止')
    // 待办列表没变化时不会重复插
    await settle()
    expect(api.plan.value!.entries.filter(entry => entry.source === 'todo')).toHaveLength(1)
  })

  /** 触发 tron 拉取并等它落到 sortedTodos（不重建模块，只重新调用 composable） */
  async function fresh2() {
    const tronMod = await import('../useTronTodos')
    tronMod.refreshTronTodos({ force: true })
    await settle()
  }
})
