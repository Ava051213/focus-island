import { computed, ref, watch } from 'vue'
import { createPersistedStore } from './persistence'
import { useAi } from './useAi'
import { eventsNow, useEvents } from './useEvents'
import { useMemos } from './useMemos'
import { useTronTodos, todoRemainingLabel } from './useTronTodos'
import { useSettings } from './useSettings'
import { useDailyStats } from './useDailyStats'
import { buildCoachContext, recordCoachFeedback, selectUrgentTodos, type CoachFeedback } from './useAiButler'
import { toLocalDateStr } from '../utils/date'
import {
  applyPlanRefinement,
  buildRulesPlan,
  normalizeDayPlan,
  rulesGreeting,
  type DayPlan,
} from '../utils/dayPlan'

/**
 * 今日安排：当天稳定存在的一份执行计划，做完勾掉，不随后台刷新漂移。
 * 只在 panel 窗口读写；规则引擎永远先排完整骨架，模型只做可选的润色
 * （重排、补时间提示与理由、开场白），没 Key 或失败时保持规则结果。
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

    // 1. 规则引擎排完整骨架：临近截止的待办在前，小记按 置顶/放置天数/动量 打分
    const urgentTodos = selectUrgentTodos(sortedTodos.value, now.getTime(), 3)
    let entries = buildRulesPlan(
      activeMemos.value.map(memo => ({
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

    const prev = plan.value
    plan.value = {
      date,
      entries,
      origin,
      greeting,
      care,
      // 同一天内重排保留原始创建时间；跨日算新的一份
      createdAt: prev?.date === date ? prev.createdAt : Date.now(),
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

/** 勾掉/取消一条，只改这份安排，不动小记与待办本身 */
function toggleEntryDone(id: string): void {
  const current = plan.value
  if (!current) return
  const entry = current.entries.find(item => item.id === id)
  if (!entry) return
  entry.done = !entry.done
  entry.doneAt = entry.done ? Date.now() : null
  current.updatedAt = Date.now()
}

/** 这条今天先不算了，从安排里移除 */
function removeEntry(id: string): void {
  const current = plan.value
  if (!current) return
  current.entries = current.entries.filter(item => item.id !== id)
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
  }

  return {
    plan: computed(() => plan.value),
    generating: computed(() => generating.value),
    ensureTodayPlan,
    regeneratePlan,
    toggleEntryDone,
    removeEntry,
  }
}
