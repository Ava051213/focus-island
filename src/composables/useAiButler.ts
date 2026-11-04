import { computed, ref, watch } from 'vue'
import { createPersistedStore } from './persistence'
import { useAi, type CoachContext, type CoachMessage, type DailySummaryInput, type DailySummaryResult } from './useAi'
import { useDailySummaries } from './useDailySummaries'
import { useSessions } from './useSessions'
import { useSettings } from './useSettings'
import { useEvents } from './useEvents'
import { useMemos } from './useMemos'
import { useDailyStats } from './useDailyStats'
import { aggregateSessionsByTask } from '../timer/sessions'
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

export type CoachPreference = 'hard-first' | 'easy-first'

export interface CoachFeedback {
  /** 用户临时说的一句话 */
  userNote?: string
  /** 先难还是先轻松 */
  preference?: CoachPreference
  /** 换掉的小记标题 */
  dismissTitle?: string
}

export type RoundOutcome = 'done' | 'skipped' | 'abandoned' | 'extended' | 'dismissed'

/** 一轮专注的结果，先只在本机积累，不用来改变界面 */
export interface RoundRecord {
  memoId: string | null
  outcome: RoundOutcome
  minutes: number
  at: number
}

interface ButlerState {
  insights: AiInsight[]
  lastAutoAt: number
  autoDate: string
  autoRunsToday: number
  lastSeenAt: number
  /** 用户选的先后偏好 */
  preference: CoachPreference | ''
  /** 用户最近跟团子说过的话，最多保留 3 条 */
  userNotes: Array<{ text: string; at: number }>
  /** 用户换掉、当天不想再看到的小记标题 */
  dismissed: string[]
  dismissedDate: string
  /** 最近 30 轮的专注结果，用来推断节奏 */
  recentRounds: RoundRecord[]
}

const ROUND_OUTCOMES: RoundOutcome[] = ['done', 'skipped', 'abandoned', 'extended', 'dismissed']
const MAX_ROUNDS = 30

const MAX_INSIGHTS = 50
const AUTO_MIN_INTERVAL_MS = 10 * 60 * 1000
const AUTO_DEBOUNCE_MS = 90 * 1000
const AUTO_DAILY_CAP = 30
const AUTO_START_HOUR = 7
const AUTO_END_HOUR = 23

/** 晚上这个点之后完成的轮次，就当作当天收尾并生成总结 */
const SUMMARY_HOUR = 20

let summaryGenerating = false

const state = ref<ButlerState>({
  insights: [],
  lastAutoAt: 0,
  autoDate: '',
  autoRunsToday: 0,
  lastSeenAt: 0,
  preference: '',
  userNotes: [],
  dismissed: [],
  dismissedDate: '',
  recentRounds: [],
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
    const preference = raw.preference === 'hard-first' || raw.preference === 'easy-first'
      ? raw.preference
      : ''
    const userNotes = Array.isArray(raw.userNotes)
      ? raw.userNotes
          .filter((note): note is { text: string; at: number } =>
            !!note && typeof note === 'object' && typeof note.text === 'string')
          .slice(-3)
      : []
    const recentRounds = Array.isArray(raw.recentRounds)
      ? raw.recentRounds
          .filter((item): item is RoundRecord =>
            !!item
            && typeof item === 'object'
            && typeof (item as RoundRecord).at === 'number'
            && typeof (item as RoundRecord).minutes === 'number'
            && ROUND_OUTCOMES.includes((item as RoundRecord).outcome))
          .slice(-MAX_ROUNDS)
      : []
    state.value = {
      insights,
      lastAutoAt: Number(raw.lastAutoAt) || 0,
      autoDate: typeof raw.autoDate === 'string' ? raw.autoDate : '',
      autoRunsToday: Number(raw.autoRunsToday) || 0,
      lastSeenAt: Number(raw.lastSeenAt) || 0,
      preference,
      userNotes,
      dismissed: Array.isArray(raw.dismissed)
        ? raw.dismissed.filter((title): title is string => typeof title === 'string').slice(-5)
        : [],
      dismissedDate: typeof raw.dismissedDate === 'string' ? raw.dismissedDate : '',
      recentRounds,
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
      estimatedPomodoros: memo.estimatedPomodoros ?? 0,
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
    // 只传上次推荐过的小记标题，不传整段旧建议，避免模型照抄旧的时刻
    recentCoaches: state.value.insights
      .filter(item => item.kind === 'coach')
      .slice(0, 3)
      .map((item) => {
        if (item.coach) {
          return item.coach.plans.map(plan => plan.title).filter(Boolean).join('、')
        }
        return Array.from(item.content.matchAll(/「([^」]+)」/g)).map(match => match[1]).join('、')
      })
      .filter(text => text.length > 0),
    preference: state.value.preference,
    userNotes: state.value.userNotes.map(note => note.text),
    dismissed: state.value.dismissed,
  }
}

/** 把结构化建议拼成一段纯文本，给旧展示和最近建议上下文用 */
function formatCoach(message: CoachMessage): string {
  const lines = [message.greeting]
  message.plans.forEach((plan, index) => {
    const when = plan.when ? `${plan.when} ` : ''
    lines.push(`${index + 1}. ${when}${plan.title} · ${plan.pomodoros} 个番茄：${plan.reason}`)
  })
  if (message.care) lines.push(message.care)
  if (message.closing) lines.push(message.closing)
  return lines.filter(line => line.length > 0).join('\n')
}

let started = false
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let running = false

/** 最新建议还是旧结构（没有 coach 或没有 when 时段）时，需要补一次新版 */
function needsCoachUpgrade(): boolean {
  const latest = state.value.insights.find(item => item.kind === 'coach')
  if (!latest?.coach) return true
  return latest.coach.plans.some(plan => !('when' in plan))
}

function canRunAuto(): boolean {
  const { settings } = useSettings()
  const { configured } = useAi()
  if (!settings.value.aiAutoEnabled || !configured.value) return false

  const now = new Date()
  const hour = now.getHours()
  if (hour < AUTO_START_HOUR || hour >= AUTO_END_HOUR) return false
  const needsUpgrade = needsCoachUpgrade()
  if (!needsUpgrade && Date.now() - state.value.lastAutoAt < AUTO_MIN_INTERVAL_MS) return false

  const today = toLocalDateStr(now)
  if (state.value.autoDate !== today) {
    state.value.autoDate = today
    state.value.autoRunsToday = 0
  }
  return state.value.autoRunsToday < AUTO_DAILY_CAP
}

async function generateCoach(): Promise<CoachMessage> {
  const today = toLocalDateStr(new Date())
  // 换掉的条目只在当天有效，跨日清空
  if (state.value.dismissedDate !== today) {
    state.value.dismissed = []
    state.value.dismissedDate = today
  }
  const { coachToday } = useAi()
  const ctx = buildContext()
  const message = await coachToday(ctx)
  // 模型只负责给序号，真正的小记 id 和标题由本地匹配，避免编造
  const plans = message.plans
    .map((plan) => {
      const memo = plan.memoIndex ? ctx.memos[plan.memoIndex - 1] ?? null : null
      return {
        ...plan,
        memoId: memo?.id ?? null,
        title: memo?.title ?? plan.title,
      }
    })
    // 模型有时会忽略 dismissed，这里再兜一层，保证换掉的条目真的不再出现
    .filter(plan => !state.value.dismissed.includes(plan.title))
  const enriched: CoachMessage = { ...message, plans }
  addInsight('coach', '团子说', formatCoach(enriched), enriched)
  return enriched
}

/** 无 Key 或请求失败时的本地总结，保证晚上仍有内容 */
function localSummary(input: DailySummaryInput): DailySummaryResult {
  const parts = [`今天完成 ${input.pomodoros} 个番茄，专注 ${input.focusMinutes} 分钟`]
  if (input.completedMemos.length > 0) parts.push(`收起了 ${input.completedMemos.length} 条小记`)
  const summary = `${parts.join('，')}。${input.pomodoros >= 6 ? '今天挺拼的，晚上早点歇着。' : '慢慢来就好。'}`
  const tomorrow = input.completedMemos[0]
    ? `明天可以接着安排「${input.completedMemos[0]}」之后的事。`
    : '明天挑一件最想做的，先从 25 分钟开始。'
  return { summary, tomorrow }
}

/** 生成某天的总结；当天没番茄就跳过，统计有变化时覆盖当天的旧总结 */
async function generateDailySummary(date: string = toLocalDateStr(new Date())): Promise<void> {
  if (summaryGenerating) return

  const { getByDate, save } = useDailySummaries()
  const { effectiveDailyStats } = useDailyStats()
  const stat = effectiveDailyStats.value.find(item => item.date === date)
  if (!stat || stat.pomodoros <= 0) return

  const existing = getByDate(date)
  if (existing && existing.pomodoros >= stat.pomodoros) return

  const { memos } = useMemos()
  const { sessions } = useSessions()
  const byTask = aggregateSessionsByTask(sessions.value, date)

  const completedMemos = memos.value
    .filter(memo => memo.completedAt && toLocalDateStr(new Date(memo.completedAt)) === date)
    .map(memo => memo.title || stripHtml(memo.content).slice(0, 20))
    .filter(title => title.length > 0)
    .slice(0, 8)

  const workedMemos = Array.from(byTask.entries())
    .filter(([, stats]) => stats.todayPomodoros > 0)
    .map(([id, stats]) => {
      const memo = memos.value.find(item => item.id === id)
      return {
        title: memo?.title || '已删除的小记',
        pomodoros: stats.todayPomodoros,
        estimatedPomodoros: memo?.estimatedPomodoros ?? 0,
      }
    })
    .slice(0, 5)

  const input: DailySummaryInput = {
    date,
    pomodoros: stat.pomodoros,
    focusMinutes: stat.focusMinutes,
    completedMemos,
    workedMemos,
  }

  summaryGenerating = true
  try {
    const { configured, summarizeDay } = useAi()
    const result = configured.value ? await summarizeDay(input) : localSummary(input)
    save({
      date: input.date,
      pomodoros: input.pomodoros,
      focusMinutes: input.focusMinutes,
      completedMemos: input.completedMemos,
      summary: result.summary,
      tomorrow: result.tomorrow,
      createdAt: Date.now(),
    })
  } catch (e) {
    // 网络失败也要留下总结，避免晚上什么都没有
    console.error('[ai-butler] daily summary failed', e)
    const result = localSummary(input)
    save({
      date: input.date,
      pomodoros: input.pomodoros,
      focusMinutes: input.focusMinutes,
      completedMemos: input.completedMemos,
      summary: result.summary,
      tomorrow: result.tomorrow,
      createdAt: Date.now(),
    })
  } finally {
    summaryGenerating = false
  }
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

  // 启动时给一次机会：旧结构建议立即补一次新版，其余情况稍后补
  setTimeout(() => {
    if (needsCoachUpgrade()) scheduleAuto(0)
    else onChange()
    // 白天收工、晚上没再打开的情况，次日打开时补昨天的总结
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    void generateDailySummary(toLocalDateStr(yesterday))
  }, 30_000)

  // 每小时主动换一条建议，免得一整天都在复读同一句
  setInterval(() => scheduleAuto(0), 60 * 60 * 1000)
}

export function useAiButler() {
  void store.ensureLoaded()
  const { configured } = useAi()
  const { settings } = useSettings()
  const { latest: dailySummary } = useDailySummaries()

  const coachInsight = computed(() =>
    state.value.insights.find(item => item.kind === 'coach') ?? null,
  )

  async function refreshCoach(feedback: CoachFeedback = {}): Promise<void> {
    if (feedback.preference) {
      state.value.preference = feedback.preference
    }
    if (feedback.userNote) {
      const text = feedback.userNote.trim().slice(0, 120)
      if (text) {
        state.value.userNotes.push({ text, at: Date.now() })
        if (state.value.userNotes.length > 3) state.value.userNotes.shift()
      }
    }
    if (feedback.dismissTitle) {
      const title = feedback.dismissTitle.trim()
      if (title && !state.value.dismissed.includes(title)) {
        state.value.dismissed.push(title)
        if (state.value.dismissed.length > 5) state.value.dismissed.shift()
      }
    }
    await generateCoach()
    state.value.lastAutoAt = Date.now()
    const today = toLocalDateStr(new Date())
    if (state.value.autoDate !== today) {
      state.value.autoDate = today
      state.value.autoRunsToday = 0
    }
    state.value.autoRunsToday += 1
  }

  /** 记录一轮专注的结果；晚上完成的轮次顺带收尾今天的总结 */
  function recordRound(record: Omit<RoundRecord, 'at'>) {
    state.value.recentRounds.push({ ...record, at: Date.now() })
    if (state.value.recentRounds.length > MAX_ROUNDS) {
      state.value.recentRounds.splice(0, state.value.recentRounds.length - MAX_ROUNDS)
    }
    if (record.outcome === 'done' && new Date().getHours() >= SUMMARY_HOUR) {
      void generateDailySummary()
    }
  }

  return {
    insights: computed(() => state.value.insights),
    coachInsight,
    dailySummary,
    configured,
    autoEnabled: computed(() => settings.value.aiAutoEnabled),
    preference: computed(() => state.value.preference),
    refreshCoach,
    recordRound,
  }
}
