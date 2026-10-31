import { computed, ref, watch } from 'vue'
import { createPersistedStore } from './persistence'
import { useAi, type CoachContext, type PlanTaskInput } from './useAi'
import { useSettings } from './useSettings'
import { useEvents, eventDate } from './useEvents'
import { useMemos } from './useMemos'
import { useDailyStats } from './useDailyStats'
import { toLocalDateStr } from '../utils/date'

export type AiInsightKind = 'coach' | 'review'

export interface AiInsight {
  id: string
  kind: AiInsightKind
  title: string
  content: string
  createdAt: number
}

interface ButlerState {
  insights: AiInsight[]
  lastAutoAt: number
  autoDate: string
  autoRunsToday: number
  lastSeenAt: number
}

const MAX_INSIGHTS = 50
const AUTO_MIN_INTERVAL_MS = 10 * 60 * 1000
const AUTO_DEBOUNCE_MS = 90 * 1000
const AUTO_DAILY_CAP = 30
const AUTO_START_HOUR = 7
const AUTO_END_HOUR = 23

const state = ref<ButlerState>({
  insights: [],
  lastAutoAt: 0,
  autoDate: '',
  autoRunsToday: 0,
  lastSeenAt: 0,
})

const store = createPersistedStore({
  file: 'ai-insights.json',
  snapshot: () => state.value,
  restore: (data) => {
    if (!data || typeof data !== 'object') throw new Error('ai-insights.json is not an object')
    const raw = data as Partial<ButlerState>
    const insights = Array.isArray(raw.insights)
      ? raw.insights
          .filter((item): item is AiInsight =>
            !!item
            && typeof item === 'object'
            && typeof (item as AiInsight).content === 'string'
            && typeof (item as AiInsight).createdAt === 'number')
          .slice(0, MAX_INSIGHTS)
      : []
    state.value = {
      insights,
      lastAutoAt: Number(raw.lastAutoAt) || 0,
      autoDate: typeof raw.autoDate === 'string' ? raw.autoDate : '',
      autoRunsToday: Number(raw.autoRunsToday) || 0,
      lastSeenAt: Number(raw.lastSeenAt) || 0,
    }
  },
})

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function addInsight(kind: AiInsightKind, title: string, content: string) {
  state.value.insights.unshift({
    id: crypto.randomUUID(),
    kind,
    title,
    content,
    createdAt: Date.now(),
  })
  if (state.value.insights.length > MAX_INSIGHTS) {
    state.value.insights.length = MAX_INSIGHTS
  }
}

function buildContext(): CoachContext {
  const { upcoming } = useEvents()
  const { memos } = useMemos()
  const { todayStat } = useDailyStats()

  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  const recentMemos = memos.value
    .filter(memo => memo.updatedAt >= cutoff)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 3)

  // 排期事件作为「接下来有什么」喂给模型
  const tasks: PlanTaskInput[] = upcoming.value.slice(0, 12).map(event => ({
    title: event.title,
    dueDate: eventDate(event.at),
    priority: 0,
    pomodoros: 0,
  }))

  return {
    tasks,
    memos: recentMemos.map(memo => ({
      title: memo.title || '未命名',
      content: stripHtml(memo.content).slice(0, 300),
      updatedAt: memo.updatedAt,
    })),
    todayPomodoros: todayStat.value?.pomodoros ?? 0,
    completedToday: 0,
  }
}

let started = false
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let running = false

function canRunAuto(): boolean {
  const { settings } = useSettings()
  const { configured } = useAi()
  if (!settings.value.aiAutoEnabled || !configured.value) return false

  const now = new Date()
  const hour = now.getHours()
  if (hour < AUTO_START_HOUR || hour >= AUTO_END_HOUR) return false
  if (Date.now() - state.value.lastAutoAt < AUTO_MIN_INTERVAL_MS) return false

  const today = toLocalDateStr(now)
  if (state.value.autoDate !== today) {
    state.value.autoDate = today
    state.value.autoRunsToday = 0
  }
  return state.value.autoRunsToday < AUTO_DAILY_CAP
}

async function generateCoach(): Promise<string> {
  const { coachToday } = useAi()
  const content = await coachToday(buildContext())
  addInsight('coach', '小管家说', content)
  return content
}

async function runAuto() {
  if (running || !canRunAuto()) return
  running = true
  try {
    await generateCoach()
  } catch (e) {
    // 失败也记录时间，避免网络/Key 异常时反复触发
    console.error('[ai-butler] auto coach failed', e)
  } finally {
    state.value.lastAutoAt = Date.now()
    const today = toLocalDateStr(new Date())
    if (state.value.autoDate !== today) {
      state.value.autoDate = today
      state.value.autoRunsToday = 0
    }
    state.value.autoRunsToday += 1
    running = false
  }
}

function scheduleAuto(delay = AUTO_DEBOUNCE_MS) {
  if (debounceTimer !== null) return
  if (!canRunAuto()) return
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void runAuto()
  }, delay)
}

export function startAiButler() {
  if (started) return
  started = true

  const { upcoming } = useEvents()
  const { memos } = useMemos()
  const { todayStat } = useDailyStats()

  const onChange = () => scheduleAuto()

  watch(
    () => upcoming.value.map(e => `${e.id}:${e.handled}:${e.updatedAt}`).join('|'),
    onChange,
  )
  watch(
    () => memos.value.map(m => `${m.id}:${m.updatedAt}`).join('|'),
    onChange,
  )
  watch(() => todayStat.value?.pomodoros ?? 0, onChange)

  // 启动时给一次机会：若当天已有变化但还没生成过，稍后补一次
  setTimeout(onChange, 30_000)
}

export function useAiButler() {
  void store.ensureLoaded()
  const { configured } = useAi()
  const { settings } = useSettings()

  const coachInsight = computed(() =>
    state.value.insights.find(item => item.kind === 'coach') ?? null,
  )

  async function refreshCoach(): Promise<void> {
    const content = await generateCoach()
    state.value.lastAutoAt = Date.now()
    const today = toLocalDateStr(new Date())
    if (state.value.autoDate !== today) {
      state.value.autoDate = today
      state.value.autoRunsToday = 0
    }
    state.value.autoRunsToday += 1
    void content
  }

  return {
    insights: computed(() => state.value.insights),
    coachInsight,
    configured,
    autoEnabled: computed(() => settings.value.aiAutoEnabled),
    refreshCoach,
  }
}
