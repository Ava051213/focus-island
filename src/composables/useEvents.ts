import { computed, ref } from 'vue'
import { createPersistedStore } from './persistence'
import { toLocalDateStr } from '../utils/date'

export type EventTag = 'work' | 'life' | 'study' | 'other'

export const EVENT_TAGS: Array<{ id: EventTag; label: string; color: string }> = [
  { id: 'work', label: '工作', color: '#60a5fa' },
  { id: 'life', label: '生活', color: '#4ade80' },
  { id: 'study', label: '学习', color: '#c084fc' },
  { id: 'other', label: '其他', color: '#94a3b8' },
]

export interface CalendarEvent {
  id: string
  title: string
  note: string
  /** `YYYY-MM-DD` 或 `YYYY-MM-DDTHH:mm`，缺时间表示全天 */
  at: string
  tag: EventTag
  handled: boolean
  createdAt: number
  updatedAt: number
}

const events = ref<CalendarEvent[]>([])

function normalizeTag(raw: unknown): EventTag {
  const tag = String(raw ?? '')
  return (EVENT_TAGS.some(t => t.id === tag) ? tag : 'other') as EventTag
}

function restoreEvents(data: unknown) {
  if (!Array.isArray(data)) throw new Error('events.json is not an array')
  events.value = data
    .filter((raw): raw is Record<string, unknown> => !!raw && typeof raw === 'object')
    .map(raw => ({
      id: String(raw.id ?? crypto.randomUUID()),
      title: String(raw.title ?? '').trim(),
      note: String(raw.note ?? ''),
      at: String(raw.at ?? toLocalDateStr()).trim(),
      tag: normalizeTag(raw.tag),
      handled: Boolean(raw.handled),
      createdAt: Number(raw.createdAt) || Date.now(),
      updatedAt: Number(raw.updatedAt) || Date.now(),
    }))
    .filter(item => item.title.length > 0)
}

const store = createPersistedStore({
  file: 'events.json',
  snapshot: () => events.value,
  restore: restoreEvents,
})

/** 事件日期部分，用于和「今天」比较 */
export function eventDate(at: string): string {
  return at.split('T')[0] ?? ''
}

/** 事件时间部分，没有就返回 null（全天事件） */
export function eventTime(at: string): string | null {
  const time = at.split('T')[1]
  return time ? time.slice(0, 5) : null
}

/** `2026-11-05` → `11/5` */
export function eventDayLabel(at: string): string {
  const [, month, day] = eventDate(at).split('-').map(Number)
  if (!month || !day) return ''
  return `${month}/${day}`
}

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 相对「今天」的说法：今天 / 明天 / 周三 / 11/5 */
export function eventRelativeLabel(at: string, now: Date = new Date()): string {
  const date = eventDate(at)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  const target = new Date(y, m - 1, d)
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000)
  if (diff === 0) return '今天'
  if (diff === 1) return '明天'
  if (diff === 2) return '后天'
  if (diff === -1) return '昨天'
  if (diff > 2 && diff <= 6) return WEEKDAY_LABELS[target.getDay()] ?? date
  return eventDayLabel(at)
}

function isPast(event: CalendarEvent, now: Date): boolean {
  return eventDate(event.at) < toLocalDateStr(now)
}

/** 按发生时间排序：早的在前；同一天里全天事件排在有具体时间的前面 */
function compareByAt(a: CalendarEvent, b: CalendarEvent): number {
  if (a.at === b.at) return a.createdAt - b.createdAt
  return a.at < b.at ? -1 : 1
}

export function useEvents() {
  void store.ensureLoaded()

  const pending = computed(() => events.value.filter(e => !e.handled))

  /** 今天及以后，早的在前 */
  const upcoming = computed(() => {
    const now = new Date()
    return pending.value
      .filter(e => !isPast(e, now))
      .slice()
      .sort(compareByAt)
  })

  /** 已经过去的，最近的在前 */
  const overdue = computed(() => {
    const now = new Date()
    return pending.value
      .filter(e => isPast(e, now))
      .slice()
      .sort((a, b) => compareByAt(b, a))
  })

  const handledEvents = computed(() =>
    events.value.filter(e => e.handled).slice().sort((a, b) => compareByAt(b, a)),
  )

  /** 未来 N 天内的事件，供首页使用 */
  function withinDays(days: number): CalendarEvent[] {
    const now = new Date()
    const limit = new Date(now)
    limit.setDate(limit.getDate() + days)
    const limitStr = toLocalDateStr(limit)
    return upcoming.value.filter(e => eventDate(e.at) <= limitStr)
  }

  function addEvent(payload: { title: string; at: string; note?: string; tag?: EventTag }): CalendarEvent | null {
    const title = payload.title.trim()
    if (!title) return null
    const now = Date.now()
    const event: CalendarEvent = {
      id: crypto.randomUUID(),
      title,
      note: payload.note?.trim() ?? '',
      at: payload.at.trim() || toLocalDateStr(),
      tag: payload.tag ?? 'other',
      handled: false,
      createdAt: now,
      updatedAt: now,
    }
    events.value.push(event)
    return event
  }

  function updateEvent(
    id: string,
    patch: Partial<Pick<CalendarEvent, 'title' | 'note' | 'at' | 'tag' | 'handled'>>,
  ) {
    const event = events.value.find(e => e.id === id)
    if (!event) return
    Object.assign(event, patch)
    event.updatedAt = Date.now()
  }

  function deleteEvent(id: string) {
    events.value = events.value.filter(e => e.id !== id)
  }

  function toggleHandled(id: string) {
    const event = events.value.find(e => e.id === id)
    if (!event) return
    event.handled = !event.handled
    event.updatedAt = Date.now()
  }

  return {
    events,
    upcoming,
    overdue,
    handledEvents,
    withinDays,
    addEvent,
    updateEvent,
    deleteEvent,
    toggleHandled,
  }
}

const DATE_WORD_RE = /^(今天|明天|后天|大后天|(?:下)?(?:周|星期|礼拜)[一二三四五六日天])/
const DATE_NUM_RE = /^(\d{4}[-/])?\d{1,2}[-/]\d{1,2}/
const DATE_CN_RE = /^(\d{4}年)?(\d{1,2})月(\d{1,2})[日号]?/
const TIME_RE = /(\d{1,2}):(\d{2})/

const CN_DIGITS: Record<string, number> = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6,
  七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12,
}
const CN_TIME_RE = /(凌晨|上午|中午|下午|傍晚|晚上)?([一二两三四五六七八九十]{1,3})点(半|[一二三四五六七八九十]{1,2}分)?/

/** 原文里有没有能确定的日期/时刻，有的话以本地换算为准，不交给模型猜 */
export function hasExplicitSchedule(text: string): boolean {
  return /(今天|明天|后天|大后天|(?:下)?(?:周|星期|礼拜)[一二三四五六日天]|\d{4}年\d{1,2}月\d{1,2}|\d{1,2}[-/月]\d{1,2}|\d{1,2}:\d{2}|[一二两三四五六七八九十]{1,3}点)/.test(text)
}

/** 把「下午三点半」这类说法换算成 HH:mm，认不出返回 null */
function parseChineseTime(text: string): string | null {
  const match = text.match(CN_TIME_RE)
  if (!match) return null
  const period = match[1] ?? ''
  const rawHour = CN_DIGITS[match[2]]
  if (!rawHour) return null
  let hour = rawHour
  if (period === '下午' || period === '傍晚' || period === '晚上') {
    if (hour < 12) hour += 12
  } else if (period === '中午') {
    if (hour < 12) hour += 12
  } else if (period === '凌晨' && hour === 12) {
    hour = 0
  }
  let minute = 0
  if (match[3] === '半') {
    minute = 30
  } else if (match[3]) {
    const minuteText = match[3].replace('分', '')
    minute = CN_DIGITS[minuteText] ?? 0
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function weekdayToOffset(word: string, now: Date): number | null {
  const names = ['日', '一', '二', '三', '四', '五', '六']
  const target = word.slice(-1)
  const index = names.indexOf(target === '天' ? '日' : target)
  if (index < 0) return null
  const current = now.getDay()
  const base = /^下(周|星期|礼拜)/.test(word) ? 7 : 0
  let diff = index - current + base
  if (diff <= 0) diff += 7
  return diff
}

export interface QuickEventInput {
  title: string
  at: string
  tag: EventTag
}

/**
 * 一句话建事件：`周五 10:00 交报告 #工作`
 * 识别日期词、时间、#标签，剩下的全部当标题。
 */
export function parseQuickEvent(input: string, now: Date = new Date()): QuickEventInput {
  let rest = input.trim()
  let tag: EventTag = 'other'
  let offset: number | null = null
  let explicitDate: string | null = null
  let time: string | null = null

  const tagMatch = rest.match(/#(工作|生活|学习|其他)/)
  if (tagMatch) {
    tag = EVENT_TAGS.find(t => t.label === tagMatch[1])?.id ?? 'other'
    rest = rest.replace(tagMatch[0], ' ').trim()
  }

  const timeMatch = rest.match(TIME_RE)
  if (timeMatch) {
    const hour = Number(timeMatch[1])
    const minute = Number(timeMatch[2])
    if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60) {
      time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
      rest = rest.replace(timeMatch[0], ' ').trim()
    }
  }

  if (!time) {
    const chineseTime = parseChineseTime(rest)
    if (chineseTime) {
      time = chineseTime
      const chineseMatch = rest.match(CN_TIME_RE)
      if (chineseMatch) rest = rest.replace(chineseMatch[0], ' ').trim()
    }
  }

  const words = rest.split(/\s+/).filter(Boolean)
  const kept: string[] = []
  for (const word of words) {
    if (offset === null && explicitDate === null) {
      const wordMatch = word.match(DATE_WORD_RE)
      if (wordMatch) {
        const token = wordMatch[1]
        if (token === '今天') offset = 0
        else if (token === '明天') offset = 1
        else if (token === '后天') offset = 2
        else if (token === '大后天') offset = 3
        else offset = weekdayToOffset(token, now)
        const remain = word.slice(token.length)
        if (remain) kept.push(remain)
        continue
      }
      const cnMatch = word.match(DATE_CN_RE)
      if (cnMatch) {
        const month = Number(cnMatch[2])
        const day = Number(cnMatch[3])
        const year = cnMatch[1] ? Number(cnMatch[1].replace('年', '')) : now.getFullYear()
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
          explicitDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const remain = word.slice(cnMatch[0].length)
          if (remain) kept.push(remain)
          continue
        }
      }
      const numMatch = word.match(DATE_NUM_RE)
      if (numMatch) {
        // 「11-12 节」是节次不是日期，别把上课节次当月份天数
        const next = word.slice(numMatch[0].length, numMatch[0].length + 1)
        if (next && '节点时分'.includes(next)) {
          kept.push(word)
          continue
        }
        const raw = numMatch[0].replace(/\//g, '-')
        const parts = raw.split('-').filter(Boolean)
        const year = parts.length === 3 ? Number(parts[0]) : now.getFullYear()
        const month = Number(parts[parts.length - 2])
        const day = Number(parts[parts.length - 1])
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
          explicitDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const remain = word.slice(numMatch[0].length)
          if (remain) kept.push(remain)
          continue
        }
      }
    }
    kept.push(word)
  }

  let date = explicitDate
  if (!date) {
    const base = new Date(now)
    if (offset !== null) base.setDate(base.getDate() + offset)
    date = toLocalDateStr(base)
  }

  return {
    title: kept.join(' ').trim(),
    at: time ? `${date}T${time}` : date,
    tag,
  }
}
