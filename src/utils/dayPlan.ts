/**
 * 今日安排的纯函数层：排序、本地兜底排程、落盘数据校验。
 * 生成与持久化在 useTodayPlan 里，这里全部是无副作用函数。
 */

export type PlanEntrySource = 'memo' | 'todo'

/** 安排里的一条事项；勾选/移除只改这份安排，不动小记与待办本身 */
export interface PlanEntry {
  id: string
  source: PlanEntrySource
  /** 来源数据的 id：小记 id 或课程待办 id */
  refId: string
  /** 生成时的标题快照；来源还在时展示层优先用实时标题 */
  title: string
  /** 课程待办的课程名快照 */
  course?: string
  /** 模型给的时间提示（「现在起」「约 21:00」）；本地兜底为空 */
  when?: string
  /** 预计番茄数 */
  pomodoros: number
  /** 一句理由（模型解释为什么排它；本地兜底为空） */
  note?: string
  done: boolean
  doneAt: number | null
}

/** 某一天的完整安排；date 不是今天就该重排了 */
export interface DayPlan {
  /** `YYYY-MM-DD` */
  date: string
  entries: PlanEntry[]
  /** model = 按模型建议生成；fallback = 无 Key 或请求失败时的本地排程 */
  origin: 'model' | 'fallback'
  /** 模型生成时的开场白与生活提醒，团子卡直接用 */
  greeting?: string
  care?: string
  createdAt: number
  updatedAt: number
}

export interface FallbackMemoInput {
  id: string
  title: string
  estimatedPomodoros: number
  pomodoroCount: number
}

export interface FallbackTodoInput {
  id: string
  title: string
  course: string
}

/**
 * 无 Key / 请求失败时的本地排程：紧急课程待办（已按截止升序）在前，
 * 进行中小记按用户手动顺序在后，合计不超过 8 条；顺序就是建议的先后。
 */
export function buildFallbackPlan(
  memos: FallbackMemoInput[],
  todos: FallbackTodoInput[],
): PlanEntry[] {
  const cap = 8

  const candidates: Array<Omit<PlanEntry, 'id' | 'done' | 'doneAt'>> = []
  for (const todo of todos.slice(0, 2)) {
    candidates.push({
      source: 'todo',
      refId: todo.id,
      title: todo.title,
      course: todo.course || undefined,
      pomodoros: 1,
    })
  }
  for (const memo of memos) {
    if (candidates.length >= cap) break
    // 剩余量 = 估的减去已完成的；没估过就先给 1 个
    const remaining = memo.estimatedPomodoros > 0
      ? memo.estimatedPomodoros - memo.pomodoroCount
      : 1
    candidates.push({
      source: 'memo',
      refId: memo.id,
      title: memo.title || '未命名',
      pomodoros: Math.min(3, Math.max(1, remaining)),
    })
  }

  return candidates.map((candidate) => ({
    ...candidate,
    id: crypto.randomUUID(),
    done: false,
    doneAt: null,
  }))
}

function normalizeEntry(raw: unknown): PlanEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const source = item.source === 'todo' ? 'todo' : item.source === 'memo' ? 'memo' : null
  if (!source) return null
  if (typeof item.refId !== 'string' || !item.refId) return null
  if (typeof item.title !== 'string' || !item.title) return null
  const pomodoros = Number(item.pomodoros)
  return {
    id: typeof item.id === 'string' && item.id ? item.id : crypto.randomUUID(),
    source,
    refId: item.refId,
    title: item.title,
    course: typeof item.course === 'string' && item.course ? item.course : undefined,
    when: typeof item.when === 'string' && item.when ? item.when.slice(0, 12) : undefined,
    pomodoros: Number.isFinite(pomodoros) ? Math.min(3, Math.max(1, Math.round(pomodoros))) : 1,
    note: typeof item.note === 'string' && item.note ? item.note.slice(0, 80) : undefined,
    done: Boolean(item.done),
    doneAt: typeof item.doneAt === 'number' ? item.doneAt : null,
  }
}

/** 落盘数据校验：结构坏了抛错交给持久化层备份，单条坏了丢弃；旧数据的 segment 字段直接忽略 */
export function normalizeDayPlan(raw: unknown): DayPlan {
  if (!raw || typeof raw !== 'object') throw new Error('today-plan.json is not an object')
  const item = raw as Record<string, unknown>
  if (typeof item.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
    throw new Error('today-plan.json has an invalid date')
  }
  const rawEntries = Array.isArray(item.entries) ? item.entries : []
  return {
    date: item.date,
    entries: rawEntries
      .map(normalizeEntry)
      .filter((entry): entry is PlanEntry => entry !== null),
    origin: item.origin === 'model' ? 'model' : 'fallback',
    greeting: typeof item.greeting === 'string' && item.greeting ? item.greeting : undefined,
    care: typeof item.care === 'string' && item.care ? item.care : undefined,
    createdAt: Number(item.createdAt) || Date.now(),
    updatedAt: Number(item.updatedAt) || Date.now(),
  }
}

/** 展示顺序：未完成的按建议先后在前，做完的沉底 */
export function orderForDisplay(entries: PlanEntry[]): PlanEntry[] {
  return [
    ...entries.filter(entry => !entry.done),
    ...entries.filter(entry => entry.done),
  ]
}
