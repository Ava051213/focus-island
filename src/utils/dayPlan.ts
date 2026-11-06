/**
 * 今日安排的纯函数层：分段归并、本地兜底排程、落盘数据校验。
 * 生成与持久化在 useTodayPlan 里，这里全部是无副作用函数。
 */

export type PlanSegment = 'morning' | 'afternoon' | 'evening'
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
  segment: PlanSegment
  /** 预计番茄数 */
  pomodoros: number
  /** 一句理由（模型解释为什么这时候做；本地兜底为空） */
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

export const SEGMENT_LABELS: Record<PlanSegment, string> = {
  morning: '上午',
  afternoon: '下午',
  evening: '晚上',
}

const SEGMENT_ORDER: PlanSegment[] = ['morning', 'afternoon', 'evening']

function segmentForHour(hour: number): PlanSegment {
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}

export function segmentForNow(now: Date): PlanSegment {
  return segmentForHour(now.getHours())
}

/**
 * 把模型给的自由文本时间窗（「现在起」「约 21:00」「今天收尾」「晚上9点」）
 * 归到上午/下午/晚上三段；带时段词的小时数按 12 小时制补正；
 * 什么都解析不出来就按当前时刻归段。
 */
export function segmentFromWhen(when: string, now: Date): PlanSegment {
  const text = when.trim()
  if (text) {
    const timeMatch = text.match(/(\d{1,2})\s*[:：]\s*(\d{1,2})/)
    const pointMatch = text.match(/(\d{1,2})\s*[点时]/)
    let hour: number | null = timeMatch ? Number(timeMatch[1]) : pointMatch ? Number(pointMatch[1]) : null
    if (hour !== null && hour >= 0 && hour <= 23) {
      // 「晚上9点」「下午3点」这类口语写法补成 24 小时制
      if (hour < 12 && /晚|夜/.test(text)) hour += 12
      else if (hour < 12 && /下午|午后/.test(text)) hour += 12
      else if (hour < 11 && /中午/.test(text)) hour += 12
      return segmentForHour(hour)
    }
    if (/晚|夜|睡前|收尾|傍晚/.test(text)) return 'evening'
    if (/中午|午后|下午/.test(text)) return 'afternoon'
    if (/早上|上午|清晨|早晨/.test(text)) return 'morning'
  }
  return segmentForNow(now)
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

/** 兜底排程里每个时段的番茄预算（累计量），从当前时段开始往后填 */
const SEGMENT_POMODORO_BUDGET = 3

/**
 * 无 Key / 请求失败时的本地排程：紧急课程待办（已按截止升序）在前，
 * 进行中小记按用户手动顺序在后，合计不超过 8 条；
 * 从当前时段开始按累计番茄数往后分配时段。
 */
export function buildFallbackPlan(
  memos: FallbackMemoInput[],
  todos: FallbackTodoInput[],
  now: Date,
): PlanEntry[] {
  const cap = 8
  const segments = SEGMENT_ORDER.slice(SEGMENT_ORDER.indexOf(segmentForNow(now)))

  const candidates: Array<Omit<PlanEntry, 'id' | 'segment' | 'done' | 'doneAt'>> = []
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

  let cumulative = 0
  return candidates.map((candidate) => {
    const index = Math.min(
      Math.floor(cumulative / SEGMENT_POMODORO_BUDGET),
      segments.length - 1,
    )
    cumulative += candidate.pomodoros
    return {
      ...candidate,
      id: crypto.randomUUID(),
      segment: segments[index],
      done: false,
      doneAt: null,
    }
  })
}

function normalizeEntry(raw: unknown): PlanEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const source = item.source === 'todo' ? 'todo' : item.source === 'memo' ? 'memo' : null
  if (!source) return null
  if (typeof item.refId !== 'string' || !item.refId) return null
  if (typeof item.title !== 'string' || !item.title) return null
  if (item.segment !== 'morning' && item.segment !== 'afternoon' && item.segment !== 'evening') return null
  const pomodoros = Number(item.pomodoros)
  return {
    id: typeof item.id === 'string' && item.id ? item.id : crypto.randomUUID(),
    source,
    refId: item.refId,
    title: item.title,
    course: typeof item.course === 'string' && item.course ? item.course : undefined,
    segment: item.segment,
    pomodoros: Number.isFinite(pomodoros) ? Math.min(3, Math.max(1, Math.round(pomodoros))) : 1,
    note: typeof item.note === 'string' && item.note ? item.note.slice(0, 80) : undefined,
    done: Boolean(item.done),
    doneAt: typeof item.doneAt === 'number' ? item.doneAt : null,
  }
}

/** 落盘数据校验：结构坏了抛错交给持久化层备份，单条坏了丢弃 */
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

export interface PlanSegmentGroup {
  segment: PlanSegment
  label: string
  /** 未完成的在前，做完的沉底 */
  entries: PlanEntry[]
}

/** 按上午/下午/晚上分组，只保留有内容的段，供首页直接渲染 */
export function groupBySegment(entries: PlanEntry[]): PlanSegmentGroup[] {
  return SEGMENT_ORDER
    .map(segment => ({
      segment,
      label: SEGMENT_LABELS[segment],
      entries: [
        ...entries.filter(entry => entry.segment === segment && !entry.done),
        ...entries.filter(entry => entry.segment === segment && entry.done),
      ],
    }))
    .filter(group => group.entries.length > 0)
}
