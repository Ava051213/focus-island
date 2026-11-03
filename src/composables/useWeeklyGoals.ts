import { computed, ref, watch } from 'vue'
import { useNow } from '@vueuse/core'
import { createPersistedStore } from './persistence'
import { useDailyStats, type DailyStat } from './useDailyStats'
import { useMemos, type Memo } from './useMemos'
import { toLocalDateStr } from '../utils/date'

export type WeeklyGoalId = 'pomodoros' | 'focusDays' | 'memos'
export type WeeklyRewardId = 'theme-dawn' | 'mottos-gentle' | 'mascot-face'

export interface WeeklyGoal {
  id: WeeklyGoalId
  label: string
  unit: string
  target: number
  progress: number
  done: boolean
}

interface WeeklyGoalState {
  weekStart: string
  /** 每个目标在本周达成的时间，跨周清空 */
  completed: Partial<Record<WeeklyGoalId, number>>
  /** 已解锁的奖励，永久保留 */
  unlockedRewards: WeeklyRewardId[]
}

const DEFINITIONS: Array<{ id: WeeklyGoalId; label: string; unit: string; target: number }> = [
  { id: 'pomodoros', label: '番茄', unit: '个', target: 8 },
  { id: 'focusDays', label: '专注', unit: '天', target: 3 },
  { id: 'memos', label: '小记', unit: '条', target: 2 },
]

const REWARD_BY_GOAL: Record<WeeklyGoalId, WeeklyRewardId> = {
  pomodoros: 'theme-dawn',
  focusDays: 'mottos-gentle',
  memos: 'mascot-face',
}

export const WEEKLY_REWARD_LABELS: Record<WeeklyRewardId, string> = {
  'theme-dawn': '晨光主题',
  'mottos-gentle': '团子的悄悄话',
  'mascot-face': '团子的新表情',
}

const REWARD_IDS = Object.keys(WEEKLY_REWARD_LABELS) as WeeklyRewardId[]

const state = ref<WeeklyGoalState>({
  weekStart: '',
  completed: {},
  unlockedRewards: [],
})

const store = createPersistedStore({
  file: 'weekly-goals.json',
  snapshot: () => state.value,
  restore: (data) => {
    if (!data || typeof data !== 'object') throw new Error('weekly-goals.json is not an object')
    const raw = data as Partial<WeeklyGoalState>
    const completed: Partial<Record<WeeklyGoalId, number>> = {}
    if (raw.completed && typeof raw.completed === 'object') {
      for (const id of ['pomodoros', 'focusDays', 'memos'] as WeeklyGoalId[]) {
        const value = Number((raw.completed as Record<string, unknown>)[id])
        if (value > 0) completed[id] = value
      }
    }
    state.value = {
      weekStart: typeof raw.weekStart === 'string' ? raw.weekStart : '',
      completed,
      unlockedRewards: Array.isArray(raw.unlockedRewards)
        ? raw.unlockedRewards.filter((id): id is WeeklyRewardId =>
            REWARD_IDS.includes(id as WeeklyRewardId))
        : [],
    }
  },
  syncEvent: 'weekly-goals-updated',
})

/** 本周一 00:00 的本地日期；周一到周日算一周 */
export function getWeekStart(now: Date = new Date()): Date {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const offset = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - offset)
  return start
}

function calcProgress(start: Date, stats: DailyStat[], memos: Memo[]) {
  const startStr = toLocalDateStr(start)
  const weekStats = stats.filter(stat => stat.date >= startStr)
  return {
    pomodoros: weekStats.reduce((sum, stat) => sum + stat.pomodoros, 0),
    focusDays: weekStats.filter(stat => stat.pomodoros > 0).length,
    memos: memos.filter(memo => memo.completedAt && memo.completedAt >= start.getTime()).length,
  } satisfies Record<WeeklyGoalId, number>
}

let syncInstalled = false

export function useWeeklyGoals() {
  const { effectiveDailyStats } = useDailyStats()
  const { memos } = useMemos()
  // 每分钟看一眼日期，跨周时目标自动换成新一周
  const now = useNow({ interval: 60_000 })

  void store.ensureLoaded()

  const weekStart = computed(() => getWeekStart(now.value))
  const weekStartStr = computed(() => toLocalDateStr(weekStart.value))

  function sync() {
    const start = getWeekStart(new Date())
    const startStr = toLocalDateStr(start)
    if (state.value.weekStart !== startStr) {
      state.value.weekStart = startStr
      state.value.completed = {}
    }
    const progress = calcProgress(start, effectiveDailyStats.value, memos.value)
    for (const def of DEFINITIONS) {
      if (state.value.completed[def.id] || progress[def.id] < def.target) continue
      state.value.completed[def.id] = Date.now()
      const reward = REWARD_BY_GOAL[def.id]
      if (!state.value.unlockedRewards.includes(reward)) {
        state.value.unlockedRewards.push(reward)
      }
    }
  }

  if (!syncInstalled) {
    syncInstalled = true
    watch(
      () => [
        effectiveDailyStats.value.map(stat => `${stat.date}:${stat.pomodoros}`).join('|'),
        memos.value.map(memo => `${memo.id}:${memo.completedAt ?? 0}`).join('|'),
      ],
      () => sync(),
    )
    void store.ensureLoaded().then(() => sync())
  }

  const goals = computed<WeeklyGoal[]>(() => {
    const start = weekStart.value
    const progress = calcProgress(start, effectiveDailyStats.value, memos.value)
    return DEFINITIONS.map((def) => {
      const value = progress[def.id]
      return {
        ...def,
        progress: value,
        done: !!state.value.completed[def.id] || value >= def.target,
      }
    })
  })

  const doneCount = computed(() => goals.value.filter(goal => goal.done).length)
  const allDone = computed(() => doneCount.value === goals.value.length)
  const unlockedRewards = computed(() => state.value.unlockedRewards)

  return { goals, doneCount, allDone, weekStart, weekStartStr, unlockedRewards }
}

/** 只读已解锁奖励，给主窗口和设置页用；不加载统计和备忘 */
export function useRewardUnlocks() {
  void store.ensureLoaded()
  const unlockedRewards = computed(() => state.value.unlockedRewards)
  return { unlockedRewards }
}
