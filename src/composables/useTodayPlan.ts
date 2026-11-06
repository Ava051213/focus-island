import { computed, ref, watch } from 'vue'
import { createPersistedStore } from './persistence'
import { useAi, type CoachPlan } from './useAi'
import { eventsNow, useEvents } from './useEvents'
import { useMemos } from './useMemos'
import { useTronTodos } from './useTronTodos'
import { useSettings } from './useSettings'
import { useDailyStats } from './useDailyStats'
import {
  buildCoachContext,
  mapCoachPlans,
  recordCoachFeedback,
  selectUrgentTodos,
  type CoachFeedback,
} from './useAiButler'
import { toLocalDateStr } from '../utils/date'
import {
  buildFallbackPlan,
  normalizeDayPlan,
  type DayPlan,
  type PlanEntry,
} from '../utils/dayPlan'

/**
 * 今日安排：当天稳定存在的一份执行计划，做完勾掉，不随后台刷新漂移。
 * 只在 panel 窗口读写；模型只负责生成，没 Key 或失败时本地规则兜底。
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

/** 模型建议里能落地的条目转成安排条目；映射不到小记/待办的丢弃 */
function entryFromCoachPlan(coachPlan: CoachPlan): PlanEntry | null {
  const base = {
    id: crypto.randomUUID(),
    title: coachPlan.title,
    when: coachPlan.when || undefined,
    pomodoros: coachPlan.pomodoros,
    note: coachPlan.reason || undefined,
    done: false,
    doneAt: null,
  }
  if (coachPlan.todo) {
    return {
      ...base,
      source: 'todo',
      refId: coachPlan.todo.id,
      course: coachPlan.todo.course || undefined,
    }
  }
  if (!coachPlan.memoId) return null
  return { ...base, source: 'memo', refId: coachPlan.memoId }
}

/** 重新生成今天的安排：有 Key 走模型，没 Key 或失败走本地兜底，两条路都必有结果 */
async function regeneratePlan(feedback: CoachFeedback = {}): Promise<void> {
  if (generating.value) return
  generating.value = true
  try {
    recordCoachFeedback(feedback)

    // 启动瞬间文件可能还没读完：不等到位会把空列表排成一份空安排钉一整天
    const { ensureLoaded: ensureMemosLoaded } = useMemos()
    const { ensureLoaded: ensureSettingsLoaded } = useSettings()
    const { ensureLoaded: ensureEventsLoaded } = useEvents()
    const { ensureLoaded: ensureStatsLoaded } = useDailyStats()
    await Promise.all([ensureMemosLoaded(), ensureSettingsLoaded(), ensureEventsLoaded(), ensureStatsLoaded()])

    const now = new Date()
    const date = toLocalDateStr(now)

    let origin: DayPlan['origin'] = 'fallback'
    let greeting: string | undefined
    let care: string | undefined
    let entries: PlanEntry[] = []

    const { configured, coachToday } = useAi()
    if (configured.value) {
      try {
        const ctx = buildCoachContext()
        const message = mapCoachPlans(await coachToday(ctx), ctx, ctx.dismissed)
        entries = message.plans
          .map(entryFromCoachPlan)
          .filter((entry): entry is PlanEntry => entry !== null)
          .slice(0, 8)
        greeting = message.greeting || undefined
        care = message.care || undefined
        origin = 'model'
      } catch (e) {
        console.error('[today-plan] model generation failed, falling back', e)
      }
    }

    if (entries.length === 0) {
      const { activeMemos } = useMemos()
      const { sortedTodos } = useTronTodos()
      entries = buildFallbackPlan(
        activeMemos.value.map(memo => ({
          id: memo.id,
          title: memo.title,
          estimatedPomodoros: memo.estimatedPomodoros,
          pomodoroCount: memo.pomodoroCount,
        })),
        selectUrgentTodos(sortedTodos.value, now.getTime(), 2).map(todo => ({
          id: todo.id,
          title: todo.title,
          course: todo.course,
        })),
      )
      origin = 'fallback'
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
