import { computed, ref, watch } from 'vue'
import { createPersistedStore } from './persistence'
import { useAi, type CoachContext, type CoachMessage } from './useAi'
import { useSettings } from './useSettings'
import { useEvents } from './useEvents'
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
  /** 管家结构化建议；旧数据没有这个字段，首页会退回显示 content */
  coach?: CoachMessage
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

function addInsight(kind: AiInsightKind, title: string, content: string, coach?: CoachMessage) {
  state.value.insights.unshift({
    id: crypto.randomUUID(),
    kind,
    title,
    content,
    createdAt: Date.now(),
    coach,
  })
  if (state.value.insights.length > MAX_INSIGHTS) {
    state.value.insights.length = MAX_INSIGHTS
  }
}

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function resolveTimeOfDay(hour: number): string {
  if (hour < 5) return '深夜'
  if (hour < 8) return '清晨'
  if (hour < 11) return '上午'
  if (hour < 13) return '中午'
  if (hour < 17) return '下午'
  if (hour < 19) return '傍晚'
  if (hour < 23) return '晚上'
  return '深夜'
}

/** 把日程时间换算成「还有多少分钟」，超过一天返回 null */
function minutesUntil(at: string, now: Date): number | null {
  const [datePart, timePart] = at.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  const [hh, mm] = (timePart ?? '00:00').split(':').map(Number)
  const diff = Math.round((new Date(y, m - 1, d, hh, mm).getTime() - now.getTime()) / 60000)
  return diff >= 0 && diff <= 1440 ? diff : null
}

function buildContext(): CoachContext {
  const { upcoming, overdue } = useEvents()
  const { memos, activeMemos } = useMemos()
  const { todayStat } = useDailyStats()
  const { settings } = useSettings()

  // 只拿还在进行中的小记，按用户手动排好的顺序取前 5 条
  const ordered = activeMemos.value.slice(0, 5)

  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const nowText = `${toLocalDateStr(now)} ${hh}:${mm} ${WEEKDAY_NAMES[now.getDay()]}`

  const next = upcoming.value[0] ?? null
  const minutesToNextEvent = next ? minutesUntil(next.at, now) : null
  const todayStr = toLocalDateStr(now)

  return {
    now: nowText,
    timeOfDay: resolveTimeOfDay(now.getHours()),
    minutesToNextEvent,
    nextEventTitle: next?.title ?? null,
    focusMinutes: settings.value.focusDuration,
    memos: ordered.map(memo => ({
      id: memo.id,
      title: memo.title || '未命名',
      content: stripHtml(memo.content).slice(0, 200),
      pomodoros: memo.pomodoroCount,
      daysSinceUpdate: Math.floor((now.getTime() - memo.updatedAt) / 86400000),
      pinned: memo.isPinned,
    })),
    events: upcoming.value.slice(0, 8).map(event => ({
      title: event.title,
      at: event.at,
      inMinutes: minutesUntil(event.at, now),
    })),
    overdueCount: overdue.value.length,
    todayPomodoros: todayStat.value?.pomodoros ?? 0,
    focusMinutesToday: todayStat.value?.focusMinutes ?? 0,
    completedToday: memos.value
      .filter(memo => memo.completedAt && toLocalDateStr(new Date(memo.completedAt)) === todayStr)
      .map(memo => memo.title || stripHtml(memo.content).slice(0, 20))
      .filter(title => title.length > 0)
      .slice(0, 5),
    recentCoaches: state.value.insights
      .filter(item => item.kind === 'coach')
      .slice(0, 3)
      .map(item => item.content)
      .filter(content => content.length > 0),
  }
}

/** 把结构化建议拼成一段纯文本，给旧展示和最近建议上下文用 */
function formatCoach(message: CoachMessage): string {
  const lines = [message.greeting]
  message.plans.forEach((plan, index) => {
    lines.push(`${index + 1}. ${plan.title} · ${plan.pomodoros} 个番茄：${plan.reason}`)
  })
  if (message.care) lines.push(message.care)
  if (message.closing) lines.push(message.closing)
  return lines.filter(line => line.length > 0).join('\n')
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
  // 最新一条还是旧格式（没有结构化 coach）时，跳过十分钟间隔，先补一次新版
  const latestCoach = state.value.insights.find(item => item.kind === 'coach')
  const needsUpgrade = !latestCoach?.coach
  if (!needsUpgrade && Date.now() - state.value.lastAutoAt < AUTO_MIN_INTERVAL_MS) return false

  const today = toLocalDateStr(now)
  if (state.value.autoDate !== today) {
    state.value.autoDate = today
    state.value.autoRunsToday = 0
  }
  return state.value.autoRunsToday < AUTO_DAILY_CAP
}

async function generateCoach(): Promise<CoachMessage> {
  const { coachToday } = useAi()
  const ctx = buildContext()
  const message = await coachToday(ctx)
  // 模型只负责给序号，真正的小记 id 和标题由本地匹配，避免编造
  const plans = message.plans.map((plan) => {
    const memo = plan.memoIndex ? ctx.memos[plan.memoIndex - 1] ?? null : null
    return {
      ...plan,
      memoId: memo?.id ?? null,
      title: memo?.title ?? plan.title,
    }
  })
  const enriched: CoachMessage = { ...message, plans }
  addInsight('coach', '小管家说', formatCoach(enriched), enriched)
  return enriched
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
    () => memos.value.map(m => `${m.id}:${m.updatedAt}:${m.completedAt ?? 0}`).join('|'),
    onChange,
  )
  watch(() => todayStat.value?.pomodoros ?? 0, onChange)

  // 启动时给一次机会：旧格式建议立即补一次新结构，其余情况稍后补
  setTimeout(() => {
    const latestCoach = state.value.insights.find(item => item.kind === 'coach')
    if (!latestCoach?.coach) scheduleAuto(0)
    else onChange()
  }, 30_000)

  // 每小时主动换一条建议，免得一整天都在复读同一句
  setInterval(() => scheduleAuto(0), 60 * 60 * 1000)
}

export function useAiButler() {
  void store.ensureLoaded()
  const { configured } = useAi()
  const { settings } = useSettings()

  const coachInsight = computed(() =>
    state.value.insights.find(item => item.kind === 'coach') ?? null,
  )

  async function refreshCoach(): Promise<void> {
    await generateCoach()
    state.value.lastAutoAt = Date.now()
    const today = toLocalDateStr(new Date())
    if (state.value.autoDate !== today) {
      state.value.autoDate = today
      state.value.autoRunsToday = 0
    }
    state.value.autoRunsToday += 1
  }

  return {
    insights: computed(() => state.value.insights),
    coachInsight,
    configured,
    autoEnabled: computed(() => settings.value.aiAutoEnabled),
    refreshCoach,
  }
}
