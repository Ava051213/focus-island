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
  /** 今天在这条上完成的番茄数；达到 pomodoros 就自动勾掉 */
  donePomodoros: number
}

/** 某一天的完整安排；date 不是今天就该重排了 */
export interface DayPlan {
  /** `YYYY-MM-DD` */
  date: string
  entries: PlanEntry[]
  /** model = 按模型建议生成；fallback = 无 Key 或请求失败时的本地排程 */
  origin: 'model' | 'fallback'
  /** 模型生成时的开场白与生活提醒，未晚卡直接用 */
  greeting?: string
  care?: string
  /** 跨日重排时存下的前一天安排（只留一层），供次日补「计划 vs 实际」总结 */
  previous?: {
    date: string
    entries: PlanEntry[]
  }
  createdAt: number
  updatedAt: number
}

export interface RulesMemoInput {
  id: string
  title: string
  isPinned: boolean
  pomodoroCount: number
  estimatedPomodoros: number
  updatedAt: number
}

export interface RulesTodoInput {
  id: string
  title: string
  course: string
  /** 预先用 todoRemainingLabel 算好的截止文案（「剩 3.5 小时」「已过期 2 天」） */
  dueLabel: string
}

const PLAN_CAP = 8
const MEMO_SCORE_PINNED = 30
const MEMO_SCORE_IDLE_FACTOR = 2
const MEMO_SCORE_IDLE_CAP = 14
const MEMO_SCORE_DONE_FACTOR = 3
const MEMO_SCORE_DONE_CAP = 10

function daysIdleOf(memo: RulesMemoInput, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - memo.updatedAt) / 86400000))
}

/** 放置越久、越接近完成、越是置顶，越该今天动 */
function memoScore(memo: RulesMemoInput, now: Date): number {
  return (memo.isPinned ? MEMO_SCORE_PINNED : 0)
    + Math.min(MEMO_SCORE_IDLE_CAP, daysIdleOf(memo, now)) * MEMO_SCORE_IDLE_FACTOR
    + Math.min(MEMO_SCORE_DONE_CAP, memo.pomodoroCount) * MEMO_SCORE_DONE_FACTOR
}

/** 朴素但有事实的文案：最多取两条事实 */
function memoNote(memo: RulesMemoInput, now: Date): string | undefined {
  const facts: string[] = []
  if (memo.isPinned) facts.push('置顶的事')
  const idle = daysIdleOf(memo, now)
  if (idle >= 3) facts.push(`放了 ${idle} 天没动了`)
  if (memo.pomodoroCount > 0) facts.push(`已经跑了 ${memo.pomodoroCount} 轮`)
  if (memo.estimatedPomodoros > 0 && memo.estimatedPomodoros - memo.pomodoroCount <= 1) {
    facts.push('就差最后 1 个番茄')
  }
  return facts.slice(0, 2).join(' · ') || undefined
}

/**
 * 本地规则排程，永远先排完整骨架：
 * 临近截止的课程待办（已按截止升序传入）在前，昨天顺延的未完成条目居中，
 * 小记按打分在后，合计不超过 8 条。
 */
export function buildRulesPlan(
  memos: RulesMemoInput[],
  todos: RulesTodoInput[],
  now: Date,
  carryOver: PlanEntry[] = [],
): PlanEntry[] {
  const candidates: Array<Omit<PlanEntry, 'id' | 'done' | 'doneAt' | 'donePomodoros'>> = []
  const carriedMemoIds = new Set(
    carryOver.filter(entry => entry.source === 'memo').map(entry => entry.refId),
  )
  const carriedTodoIds = new Set(
    carryOver.filter(entry => entry.source === 'todo').map(entry => entry.refId),
  )
  let todoCount = 0
  for (const todo of todos) {
    if (todoCount >= 3) break
    if (carriedTodoIds.has(todo.id)) continue
    candidates.push({
      source: 'todo',
      refId: todo.id,
      title: todo.title,
      course: todo.course || undefined,
      when: undefined,
      pomodoros: 1,
      note: todo.dueLabel || undefined,
    })
    todoCount += 1
  }
  // 昨天没做完的顺延下来，进度清零重计
  for (const carried of carryOver) {
    if (candidates.length >= PLAN_CAP) break
    candidates.push({
      source: carried.source,
      refId: carried.refId,
      title: carried.title,
      course: carried.course,
      when: undefined,
      pomodoros: carried.pomodoros,
      note: '昨天顺延下来',
    })
  }

  // 稳定排序：同分保持用户手动顺序
  const ranked = memos
    .map((memo, index) => ({ memo, index, score: memoScore(memo, now) }))
    .sort((a, b) => b.score - a.score)
  for (const { memo } of ranked) {
    if (candidates.length >= PLAN_CAP) break
    if (carriedMemoIds.has(memo.id)) continue
    // 剩余量 = 估的减去已完成的；没估过就先给 1 个
    const remaining = memo.estimatedPomodoros > 0
      ? memo.estimatedPomodoros - memo.pomodoroCount
      : 1
    candidates.push({
      source: 'memo',
      refId: memo.id,
      title: memo.title || '未命名',
      when: undefined,
      pomodoros: Math.min(3, Math.max(1, remaining)),
      note: memoNote(memo, now),
    })
  }

  return candidates.map((candidate) => ({
    ...candidate,
    id: crypto.randomUUID(),
    done: false,
    doneAt: null,
    donePomodoros: 0,
  }))
}

/** 无模型时的开场白：报个数、指个开头；没有条目就不说 */
export function rulesGreeting(entries: PlanEntry[], now: Date): string | undefined {
  if (entries.length === 0) return undefined
  const hour = now.getHours()
  const timeWord = hour < 6 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好'
  return `${timeWord}，排好了今天要做的 ${entries.length} 件事，先从「${entries[0].title}」动手吧。`
}

/** 傍晚收口：18 点后报今天还剩几件；没到点或没有剩余就不说 */
export function planClosing(entries: PlanEntry[], now: Date): string | undefined {
  if (now.getHours() < 18) return undefined
  const idle = entries.filter(entry => !entry.done)
  if (idle.length === 0) return undefined
  const listed = idle.slice(0, 2).map(entry => entry.title).join('、')
  return idle.length <= 2
    ? `今天还剩 ${idle.length} 件：${listed}`
    : `今天还剩 ${idle.length} 件：${listed} 等`
}

export interface PlanFacts {
  planned: number
  finished: number
  finishedTitles: string[]
  idleTitles: string[]
}

/** 「计划 vs 实际」事实提取：当天计划优先，其次 previous 里存的昨天计划 */
export function planFactsForDate(plan: DayPlan | null | undefined, date: string): PlanFacts | undefined {
  const entries = plan?.date === date
    ? plan.entries
    : plan?.previous?.date === date
      ? plan.previous.entries
      : null
  if (!entries || entries.length === 0) return undefined
  const finished = entries.filter(entry => entry.done)
  const idle = entries.filter(entry => !entry.done)
  return {
    planned: entries.length,
    finished: finished.length,
    finishedTitles: finished.map(entry => entry.title),
    idleTitles: idle.map(entry => entry.title),
  }
}

export interface PlanRefinementApplied {
  entries: PlanEntry[]
  greeting?: string
  care?: string
}

/**
 * 把模型的润色结果套到规则骨架上，纯函数。
 * items 的 index 按骨架原序号（先套注解），order 再重排；
 * order 必须是 1..n 的完整排列才采纳；when/note 空值不覆盖，超长截断；greeting 为空保留规则版。
 */
export function applyPlanRefinement(entries: PlanEntry[], refinement: unknown): PlanRefinementApplied {
  const applied: PlanRefinementApplied = { entries: [...entries] }
  if (!refinement || typeof refinement !== 'object') return applied
  const raw = refinement as Record<string, unknown>

  if (Array.isArray(raw.items)) {
    for (const item of raw.items) {
      if (!item || typeof item !== 'object') continue
      const record = item as Record<string, unknown>
      const index = Number(record.index)
      if (!Number.isInteger(index) || index < 1 || index > applied.entries.length) continue
      const entry = applied.entries[index - 1]
      const when = typeof record.when === 'string' ? record.when.trim().slice(0, 12) : ''
      const note = typeof record.note === 'string' ? record.note.trim().slice(0, 80) : ''
      if (when) entry.when = when
      if (note) entry.note = note
    }
  }

  const total = entries.length
  if (Array.isArray(raw.order) && total > 0) {
    const order = raw.order.map(value => Number(value))
    const seen = new Set<number>()
    let valid = order.length === total
    for (const value of order) {
      if (!Number.isInteger(value) || value < 1 || value > total || seen.has(value)) {
        valid = false
        break
      }
      seen.add(value)
    }
    if (valid) applied.entries = order.map(value => applied.entries[value - 1])
  }

  const greeting = typeof raw.greeting === 'string' ? raw.greeting.trim().slice(0, 100) : ''
  if (greeting) applied.greeting = greeting
  const care = typeof raw.care === 'string' ? raw.care.trim().slice(0, 60) : ''
  if (care) applied.care = care
  return applied
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
    donePomodoros: Math.max(0, Math.round(Number(item.donePomodoros) || 0)),
  }
}

function normalizePrevious(raw: unknown): DayPlan['previous'] {
  if (!raw || typeof raw !== 'object') return undefined
  const item = raw as Record<string, unknown>
  if (typeof item.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) return undefined
  const rawEntries = Array.isArray(item.entries) ? item.entries : []
  return {
    date: item.date,
    entries: rawEntries
      .map(normalizeEntry)
      .filter((entry): entry is PlanEntry => entry !== null),
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
    previous: normalizePrevious(item.previous),
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
