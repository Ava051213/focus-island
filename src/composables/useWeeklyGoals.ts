import { computed } from 'vue'
import { useNow } from '@vueuse/core'
import { useDailyStats } from './useDailyStats'
import { useMemos } from './useMemos'
import { toLocalDateStr } from '../utils/date'

export type WeeklyGoalId = 'pomodoros' | 'focusDays' | 'memos'

export interface WeeklyGoal {
  id: WeeklyGoalId
  label: string
  unit: string
  target: number
  progress: number
  done: boolean
}

const DEFINITIONS: Array<{ id: WeeklyGoalId; label: string; unit: string; target: number }> = [
  { id: 'pomodoros', label: '番茄', unit: '个', target: 8 },
  { id: 'focusDays', label: '专注', unit: '天', target: 3 },
  { id: 'memos', label: '小记', unit: '条', target: 2 },
]

/** 本周一 00:00 的本地日期；周一到周日算一周 */
export function getWeekStart(now: Date = new Date()): Date {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const offset = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - offset)
  return start
}

export function useWeeklyGoals() {
  const { dailyStats } = useDailyStats()
  const { memos } = useMemos()
  // 每分钟看一眼日期，跨周时目标自动换成新一周
  const now = useNow({ interval: 60_000 })

  const weekStart = computed(() => getWeekStart(now.value))
  const weekStartStr = computed(() => toLocalDateStr(weekStart.value))

  const goals = computed<WeeklyGoal[]>(() => {
    const start = weekStart.value
    const startStr = weekStartStr.value
    const stats = dailyStats.value.filter(stat => stat.date >= startStr)
    const pomodoros = stats.reduce((sum, stat) => sum + stat.pomodoros, 0)
    const focusDays = stats.filter(stat => stat.pomodoros > 0).length
    const completedMemos = memos.value.filter(memo =>
      memo.completedAt && memo.completedAt >= start.getTime()
    ).length

    const progressMap: Record<WeeklyGoalId, number> = {
      pomodoros,
      focusDays,
      memos: completedMemos,
    }

    return DEFINITIONS.map(def => {
      const progress = progressMap[def.id]
      return {
        ...def,
        progress,
        done: progress >= def.target,
      }
    })
  })

  const doneCount = computed(() => goals.value.filter(goal => goal.done).length)
  const allDone = computed(() => doneCount.value === goals.value.length)

  return { goals, doneCount, allDone, weekStart }
}
