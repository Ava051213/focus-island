import { computed, ref } from 'vue'
import { createPersistedStore } from './persistence'

/** 团子生成的每日总结，按日期保留最近 30 天 */
export interface DailySummary {
  /** YYYY-MM-DD */
  date: string
  pomodoros: number
  focusMinutes: number
  completedMemos: string[]
  /** 团子对今天的总结 */
  summary: string
  /** 明天一句建议 */
  tomorrow: string
  createdAt: number
}

const MAX_SUMMARIES = 30

const summaries = ref<DailySummary[]>([])

function isValidSummary(value: unknown): value is DailySummary {
  if (!value || typeof value !== 'object') return false
  const item = value as DailySummary
  return typeof item.date === 'string'
    && typeof item.summary === 'string'
    && typeof item.tomorrow === 'string'
    && typeof item.createdAt === 'number'
    && Number.isFinite(item.createdAt)
}

const store = createPersistedStore({
  file: 'daily-summaries.json',
  snapshot: () => summaries.value,
  restore: (data) => {
    if (!Array.isArray(data)) throw new Error('daily-summaries.json is not an array')
    summaries.value = data
      .filter(isValidSummary)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-MAX_SUMMARIES)
  },
})

export function useDailySummaries() {
  void store.ensureLoaded()

  function save(summary: DailySummary) {
    const list = summaries.value.filter(item => item.date !== summary.date)
    list.push(summary)
    summaries.value = list.sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_SUMMARIES)
  }

  function getByDate(date: string): DailySummary | null {
    return summaries.value.find(item => item.date === date) ?? null
  }

  const latest = computed(() => summaries.value[summaries.value.length - 1] ?? null)

  return {
    summaries,
    latest,
    save,
    getByDate,
    loaded: store.loaded,
  }
}
