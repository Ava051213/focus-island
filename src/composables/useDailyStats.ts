import { ref, computed } from 'vue'
import { createPersistedStore } from './persistence'
import { useSessions } from './useSessions'
import { toLocalDateStr } from '../utils/date'

export interface DailyStat {
  date: string        // "2026-04-18"
  pomodoros: number   // 当日番茄数
  focusMinutes: number // 当日专注分钟
  tasksCompleted: number // 当日完成任务数
}

const dailyStats = ref<DailyStat[]>([])

const store = createPersistedStore({
  file: 'daily-stats.json',
  schemaVersion: 1,
  snapshot: () => dailyStats.value,
  restore: (data) => {
    if (!Array.isArray(data)) throw new Error('daily-stats.json is not an array')
    dailyStats.value = data as DailyStat[]
  },
})

const getDateString = toLocalDateStr

/** 旧累加值保留为历史基线，新轮次从 Session 账本合并进来 */
const { mergeDaily } = useSessions()
const effectiveDailyStats = computed<DailyStat[]>(() => mergeDaily(dailyStats.value))

function getEffectiveStatByDate(date: string): DailyStat | undefined {
  return effectiveDailyStats.value.find(s => s.date === date)
}

export function useDailyStats() {
  void store.ensureLoaded()

  function getStatsInRange(startDate: Date, endDate: Date): DailyStat[] {
    const start = getDateString(startDate)
    const end = getDateString(endDate)
    return effectiveDailyStats.value.filter(s => s.date >= start && s.date <= end)
  }

  function getMonthStats(year: number, month: number): DailyStat[] {
    const start = new Date(year, month, 1)
    const end = new Date(year, month + 1, 0)
    return getStatsInRange(start, end)
  }

  const todayStat = computed(() => {
    const today = getDateString()
    return getEffectiveStatByDate(today) ?? { date: today, pomodoros: 0, focusMinutes: 0, tasksCompleted: 0 }
  })

  const weekStats = computed(() => {
    const now = new Date()
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - now.getDay())
    weekStart.setHours(0, 0, 0, 0)
    return getStatsInRange(weekStart, now)
  })

  const monthStats = computed(() => {
    const now = new Date()
    return getMonthStats(now.getFullYear(), now.getMonth())
  })

  const allTimeStats = computed(() => {
    const total = { pomodoros: 0, focusMinutes: 0, tasksCompleted: 0 }
    for (const stat of effectiveDailyStats.value) {
      total.pomodoros += stat.pomodoros
      total.focusMinutes += stat.focusMinutes
      total.tasksCompleted += stat.tasksCompleted
    }
    return total
  })

  function summarizeStats(stats: DailyStat[]) {
    return stats.reduce(
      (acc, s) => ({
        pomodoros: acc.pomodoros + s.pomodoros,
        focusMinutes: acc.focusMinutes + s.focusMinutes,
        tasksCompleted: acc.tasksCompleted + s.tasksCompleted,
      }),
      { pomodoros: 0, focusMinutes: 0, tasksCompleted: 0 }
    )
  }

  return {
    ensureLoaded: () => store.ensureLoaded(),
    dailyStats,
    effectiveDailyStats,
    todayStat,
    weekStats,
    monthStats,
    allTimeStats,
    getStatsInRange,
    getMonthStats,
    summarizeStats,
    getDateString,
  }
}
