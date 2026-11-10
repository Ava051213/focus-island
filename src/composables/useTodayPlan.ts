import { computed, ref, watch } from 'vue'
import { createPersistedStore } from './persistence'
import { useAi } from './useAi'
import { eventsNow, useEvents } from './useEvents'
import { useMemos, isMemoDoneToday } from './useMemos'
import { useTronTodos, todoRemainingLabel } from './useTronTodos'
import { useSettings } from './useSettings'
import { useDailyStats } from './useDailyStats'
import { buildCoachContext, recordCoachFeedback, selectUrgentTodos, type CoachFeedback } from './useAiButler'
import { toLocalDateStr } from '../utils/date'
import {
  applyPlanRefinement,
  buildRulesPlan,
  normalizeDayPlan,
  planClosing,
  rulesGreeting,
  type DayPlan,
  type PlanEntry,
} from '../utils/dayPlan'

/**
 * 今日安排：当天稳定存在的一份执行计划，做完勾掉，不随后台刷新漂移。
 * 只在 panel 窗口读写；规则引擎永远先排完整骨架，模型只做可选的润色。
 * 完成的番茄当场推进条目，没做完的跨日顺延，新截止插队，傍晚收口报剩余。
 */
const plan = ref<DayPlan | null>(null)
const generating = ref(false)

const store = createPersistedStore({
  file: 'today-plan.json',
  schemaVersion: 1,
  snapshot: () => plan.value,
  restore: (data) => {
    plan.value = normalizeDayPlan(data)
  },
})

/** 生成今天的安排：规则排骨架，有 Key 再让模型润色；两条路都必有完整结果 */
async function regeneratePlan(feedback: CoachFeedback = {}): Promise<void> {
  if (generating.value) return
  generating.value = true
  try {
    recordCoachFeedback(feedback)

    // 启动瞬间文件可能还没读完：不等到位会把空列表排成一份空安排钉一整天
    const { activeMemos, ensureLoaded: ensureMemosLoaded } = useMemos()
    const { ensureLoaded: ensureSettingsLoaded } = useSettings()
    const { ensureLoaded: ensureEventsLoaded } = useEvents()
    const { ensureLoaded: ensureStatsLoaded } = useDailyStats()
    await Promise.all([ensureMemosLoaded(), ensureSettingsLoaded(), ensureEventsLoaded(), ensureStatsLoaded()])

    const now = new Date()
    const date = toLocalDateStr(now)
    const { sortedTodos } = useTronTodos()
    const urgentTodos = selectUrgentTodos(sortedTodos.value, now.getTime(), 3)

    const prev = plan.value
    const sameDay = prev?.date === date
    // 跨日顺延：昨天没做完、且今天还有着落的（小记仍在进行中 / 待办仍在紧急窗内），最多 3 条
    const carryOver = prev && !sameDay
      ? prev.entries
          .filter(entry => !entry.done)
          .filter(entry => entry.source === 'memo'
            ? activeMemos.value.some(memo => memo.id === entry.refId)
            : urgentTodos.some(todo => todo.id === entry.refId))
          .slice(0, 3)
      : []

    // 1. 规则引擎排完整骨架：待办在前，顺延居中，小记按 置顶/放置天数/动量 打分
    // 今天已打卡的重复小记不进候选：今天做完了，别再占安排的坑
    const planCandidates = activeMemos.value.filter(memo => !isMemoDoneToday(memo))
    let entries = buildRulesPlan(
      planCandidates.map(memo => ({
        id: memo.id,
        title: memo.title,
        isPinned: memo.isPinned,
        pomodoroCount: memo.pomodoroCount,
        estimatedPomodoros: memo.estimatedPomodoros,
        updatedAt: memo.updatedAt,
      })),
      urgentTodos.map(todo => ({
        id: todo.id,
        title: todo.title,
        course: todo.course,
        dueLabel: todoRemainingLabel(todo, now.getTime()),
      })),
      now,
      carryOver,
    )
    let greeting = rulesGreeting(entries, now)
    let care: string | undefined
    let origin: DayPlan['origin'] = 'fallback'

    // 2. 有 Key 时让模型润色；失败就保持规则结果，不影响可用性
    const { configured, refinePlan } = useAi()
    if (configured.value && entries.length > 0) {
      try {
        const ctx = buildCoachContext()
        const refinement = await refinePlan({
          now: ctx.now,
          timeOfDay: ctx.timeOfDay,
          focusMinutes: ctx.focusMinutes,
          preference: ctx.preference,
          userNotes: ctx.userNotes,
          todayPomodoros: ctx.todayPomodoros,
          minutesToNextEvent: ctx.minutesToNextEvent,
          nextEventTitle: ctx.nextEventTitle,
          entries: entries.map((entry, position) => {
            const memo = entry.source === 'memo'
              ? activeMemos.value.find(item => item.id === entry.refId)
              : undefined
            const todo = entry.source === 'todo'
              ? urgentTodos.find(item => item.id === entry.refId)
              : undefined
            return {
              index: position + 1,
              title: entry.title,
              source: entry.source,
              course: entry.course,
              pomodoros: entry.pomodoros,
              note: entry.note ?? '',
              dueLabel: todo ? todoRemainingLabel(todo, now.getTime()) : undefined,
              daysIdle: memo
                ? Math.max(0, Math.floor((now.getTime() - memo.updatedAt) / 86400000))
                : undefined,
              pomodorosDone: memo ? memo.pomodoroCount : undefined,
            }
          }),
        })
        const applied = applyPlanRefinement(entries, refinement)
        entries = applied.entries
        greeting = applied.greeting ?? greeting
        care = applied.care
        origin = 'model'
      } catch (e) {
        console.error('[today-plan] model refinement failed, keeping rule plan', e)
      }
    }

    plan.value = {
      date,
      entries,
      origin,
      greeting,
      care,
      // 跨日把前一天存进 previous（只留一层），供次日补「计划 vs 实际」总结
      previous: sameDay
        ? prev?.previous
        : prev
          ? { date: prev.date, entries: prev.entries }
          : undefined,
      // 同一天内重排保留原始创建时间；跨日算新的一份
      createdAt: sameDay && prev ? prev.createdAt : Date.now(),
      updatedAt: Date.now(),
    }
  } finally {
    generating.value = false
  }
}

/** 当天已有安排就不动（稳定不漂移）；没有或已跨日才重排 */
async function ensureTodayPlan(): Promise<void> {
  await store.ensureLoaded()
  const today = toLocalDateStr(new Date())
  if (plan.value && plan.value.date === today && plan.value.entries.length > 0) return
  await regeneratePlan()
}

/**
 * 重复小记的打卡与今日安排保持一致：勾小记连带勾条目，勾条目连带打卡。
 * 普通小记不受影响（维持「勾选不动小记」的约定）。
 */
function syncMemoCheckIn(memoId: string, done: boolean): void {
  const { memos, checkInToday, uncheckIn } = useMemos()
  const memo = memos.value.find(item => item.id === memoId)
  if (!memo || memo.repeat !== 'daily') return
  if (done) checkInToday(memoId)
  else uncheckIn(memoId)

  const current = plan.value
  if (!current) return
  const entry = current.entries.find(item => item.source === 'memo' && item.refId === memoId)
  if (!entry || entry.done === done) return
  entry.done = done
  entry.doneAt = done ? Date.now() : null
  current.updatedAt = Date.now()
}

/** 勾掉/取消一条：普通条目只改安排；重复小记的条目连带打卡/取消 */
function toggleEntryDone(id: string): void {
  const current = plan.value
  if (!current) return
  const entry = current.entries.find(item => item.id === id)
  if (!entry) return
  entry.done = !entry.done
  entry.doneAt = entry.done ? Date.now() : null
  current.updatedAt = Date.now()
  if (entry.source === 'memo') syncMemoCheckIn(entry.refId, entry.done)
}

/** 这条今天先不算了，从安排里移除 */
function removeEntry(id: string): void {
  const current = plan.value
  if (!current) return
  current.entries = current.entries.filter(item => item.id !== id)
  current.updatedAt = Date.now()
}

/** 调整未完成条目的顺序：置顶或沉到未完成区末尾（做完的始终沉底） */
function moveEntry(id: string, position: 'top' | 'bottom'): void {
  const current = plan.value
  if (!current) return
  const index = current.entries.findIndex(item => item.id === id)
  if (index === -1) return
  const entry = current.entries[index]
  if (entry.done) return
  current.entries.splice(index, 1)
  if (position === 'top') {
    current.entries.unshift(entry)
  } else {
    const undoneCount = current.entries.filter(item => !item.done).length
    current.entries.splice(undoneCount, 0, entry)
  }
  current.updatedAt = Date.now()
}

/** 完成一轮番茄后推进对应条目；达到预计数就自动勾掉 */
function advanceEntry(memoId: string): void {
  if (!memoId) return
  const current = plan.value
  if (!current) return
  const entry = current.entries.find(item => item.source === 'memo' && item.refId === memoId && !item.done)
  if (!entry) return
  entry.donePomodoros += 1
  if (entry.donePomodoros >= entry.pomodoros) {
    entry.done = true
    entry.doneAt = Date.now()
    // 重复小记的条目跑满额自动勾掉时，今天的打卡一并记上
    syncMemoCheckIn(memoId, true)
  }
  current.updatedAt = Date.now()
}

/** 新截止插队：紧急窗内的新待办插入安排，不动其余条目的顺序 */
function insertUrgentTodo(): void {
  const current = plan.value
  if (!current || generating.value) return
  if (current.date !== toLocalDateStr(new Date())) return
  const now = new Date()
  const { sortedTodos } = useTronTodos()
  const urgent = selectUrgentTodos(sortedTodos.value, now.getTime(), 3)
  const existing = new Set(
    current.entries.filter(entry => entry.source === 'todo').map(entry => entry.refId),
  )
  const fresh = urgent.filter(todo => !existing.has(todo.id))
  if (fresh.length === 0) return
  const inserts: PlanEntry[] = fresh.map(todo => ({
    id: crypto.randomUUID(),
    source: 'todo',
    refId: todo.id,
    title: todo.title,
    course: todo.course || undefined,
    when: undefined,
    pomodoros: 1,
    note: `${todoRemainingLabel(todo, now.getTime())} · 新进来的截止`,
    done: false,
    doneAt: null,
    donePomodoros: 0,
  }))
  const firstTodoIndex = current.entries.findIndex(entry => entry.source === 'todo')
  current.entries.splice(firstTodoIndex === -1 ? 0 : firstTodoIndex, 0, ...inserts)
  current.updatedAt = Date.now()
}

let dayWatchInstalled = false

export function useTodayPlan() {
  void store.ensureLoaded()

  if (!dayWatchInstalled) {
    dayWatchInstalled = true
    watch(
      () => toLocalDateStr(eventsNow.value),
      (today) => {
        // 面板开着跨了零点：停留的还是昨天的安排，重排一份今天的
        if (plan.value && plan.value.date !== today) void regeneratePlan()
      },
    )
    const { sortedTodos } = useTronTodos()
    watch(
      () => sortedTodos.value.map(todo => todo.id).join('|'),
      () => insertUrgentTodo(),
    )
  }

  const closing = computed(() => {
    const current = plan.value
    if (!current || current.date !== toLocalDateStr(eventsNow.value)) return null
    return planClosing(current.entries, eventsNow.value) ?? null
  })

  return {
    plan: computed(() => plan.value),
    generating: computed(() => generating.value),
    closing,
    ensureTodayPlan,
    regeneratePlan,
    toggleEntryDone,
    removeEntry,
    moveEntry,
    advanceEntry,
    /** 小记卡片打卡/取消用：同步安排条目，普通小记是空操作 */
    checkInMemo: syncMemoCheckIn,
  }
}

/** 供 useAiButler 取计划做「计划 vs 实际」总结；返回值只读使用 */
export function getPlanSnapshot(): DayPlan | null {
  return plan.value
}
