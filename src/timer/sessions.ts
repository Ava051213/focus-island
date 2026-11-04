/**
 * Session 记录（纯逻辑）
 *
 * 每轮专注结束只写一条 Session；完成、跳过、中断三种状态明确区分。
 * 时长统一存秒，时间戳存毫秒，便于和现有 settings（分钟）与日期工具衔接。
 */

import { toLocalDateStr } from '../utils/date'

export type SessionStatus = 'completed' | 'skipped' | 'interrupted'

export interface Session {
  /** 优先复用本轮 roundId，保证同一轮不会写重复记录 */
  id: string
  /** 专注对象，指向一条备忘；可为空 */
  taskId: string | null
  taskTitle: string | null
  startAt: number
  endAt: number
  /** 计划时长（秒） */
  plannedDuration: number
  /** 实际专注时长（秒），不含暂停，且不超过计划时长 */
  actualDuration: number
  status: SessionStatus
  interruptReason: string | null
  createdAt: number
}

export interface SessionInput {
  id?: string | null
  roundId?: string | null
  taskId: string | null
  taskTitle?: string | null
  startAt: number
  endAt: number
  plannedDurationMs: number
  actualDurationMs: number
  status: SessionStatus
  interruptReason?: string | null
  createdAt?: number
}

function msToSeconds(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return Math.round(ms / 1000)
}

export function buildSession(input: SessionInput): Session {
  const id = (input.id?.trim() || input.roundId?.trim() || `session-${input.startAt}-${input.endAt}`)
  const endAt = Math.max(input.startAt, input.endAt)
  const plannedDuration = Math.max(0, msToSeconds(input.plannedDurationMs))
  const actualDuration = Math.min(plannedDuration, Math.max(0, msToSeconds(input.actualDurationMs)))

  return {
    id,
    taskId: input.taskId,
    taskTitle: input.taskTitle ?? null,
    startAt: input.startAt,
    endAt,
    plannedDuration,
    actualDuration,
    status: input.status,
    interruptReason: input.interruptReason ?? null,
    createdAt: input.createdAt ?? endAt,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isOptionalString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function parseSession(raw: unknown): Session | null {
  if (!isRecord(raw)) return null
  if (typeof raw.id !== 'string' || raw.id.trim() === '') return null
  if (!isOptionalString(raw.taskId) || !isOptionalString(raw.taskTitle)) return null
  if (!isOptionalString(raw.interruptReason)) return null
  if (raw.status !== 'completed' && raw.status !== 'skipped' && raw.status !== 'interrupted') return null
  if (!isFiniteNumber(raw.startAt) || raw.startAt <= 0) return null
  if (!isFiniteNumber(raw.endAt) || raw.endAt <= 0) return null
  if (!isFiniteNumber(raw.plannedDuration) || raw.plannedDuration < 0) return null
  if (!isFiniteNumber(raw.actualDuration) || raw.actualDuration < 0) return null
  if (!isFiniteNumber(raw.createdAt) || raw.createdAt <= 0) return null

  return {
    id: raw.id,
    taskId: raw.taskId,
    taskTitle: raw.taskTitle,
    startAt: raw.startAt,
    endAt: Math.max(raw.startAt, raw.endAt),
    plannedDuration: raw.plannedDuration,
    actualDuration: Math.min(raw.plannedDuration, raw.actualDuration),
    status: raw.status,
    interruptReason: raw.interruptReason,
    createdAt: raw.createdAt,
  }
}

export function parseSessionList(raw: unknown): Session[] {
  if (!Array.isArray(raw)) return []
  const sessions: Session[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const session = parseSession(item)
    if (!session || seen.has(session.id)) continue
    seen.add(session.id)
    sessions.push(session)
  }
  return sessions
}

export interface AppendResult {
  sessions: Session[]
  appended: boolean
}

/** 按 id 去重；重复调用不会产生第二条记录 */
export function appendSession(sessions: Session[], session: Session): AppendResult {
  if (sessions.some(existing => existing.id === session.id)) {
    return { sessions, appended: false }
  }
  return { sessions: [...sessions, session], appended: true }
}

/**
 * Session 记在“结束那一天”。
 * 跨零点的一轮算到完成日，和现有 recordPomodoro 在完成时累加的行为一致。
 */
export function sessionLocalDate(session: Session): string {
  return toLocalDateStr(new Date(session.endAt))
}

export interface SessionAggregate {
  date: string
  completedCount: number
  skippedCount: number
  interruptedCount: number
  completedFocusSeconds: number
  focusMinutes: number
}

export function aggregateSessionsByDate(
  sessions: readonly Session[],
  date: string,
): SessionAggregate {
  let completedCount = 0
  let skippedCount = 0
  let interruptedCount = 0
  let completedFocusSeconds = 0

  for (const session of sessions) {
    if (sessionLocalDate(session) !== date) continue
    if (session.status === 'completed') {
      completedCount++
      completedFocusSeconds += session.actualDuration
    } else if (session.status === 'skipped') {
      skippedCount++
    } else {
      interruptedCount++
    }
  }

  return {
    date,
    completedCount,
    skippedCount,
    interruptedCount,
    completedFocusSeconds,
    focusMinutes: Math.round(completedFocusSeconds / 60),
  }
}

export interface TaskFocusStats {
  /** 完成的番茄轮数 */
  pomodoros: number
  /** 完成轮次的实际专注秒数 */
  focusSeconds: number
}

/**
 * 按小记聚合完成的番茄；跳过和中断不计入。
 * 删除或改名都不影响，Session 里存的是小记 id。
 */
export function aggregateSessionsByTask(
  sessions: readonly Session[],
): Map<string, TaskFocusStats> {
  const stats = new Map<string, TaskFocusStats>()

  for (const session of sessions) {
    if (session.status !== 'completed' || !session.taskId) continue
    const entry = stats.get(session.taskId) ?? { pomodoros: 0, focusSeconds: 0 }
    entry.pomodoros += 1
    entry.focusSeconds += session.actualDuration
    stats.set(session.taskId, entry)
  }

  return stats
}

/** 把专注秒数写成便于阅读的时长 */
export function formatFocusDuration(seconds: number): string {
  if (seconds < 60) return '不到 1 分钟'

  const totalMinutes = Math.round(seconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours <= 0) return `${minutes} 分钟`
  if (minutes === 0) return `${hours} 小时`
  return `${hours} 小时 ${minutes} 分`
}

export interface DailyTotals {
  date: string
  pomodoros: number
  focusMinutes: number
  tasksCompleted: number
}

function toFiniteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * 把旧累加统计和 Session 聚合合并。
 * 旧数据保留为基线，新完成的轮次只从 Session 计入，升级当天不会重复计数。
 * 番茄数和专注分钟只统计 completed；跳过/中断只留痕，不冲高统计。
 */
export function mergeDailyStats(
  legacy: readonly DailyTotals[],
  sessions: readonly Session[],
): DailyTotals[] {
  const merged = new Map<string, DailyTotals>()
  const extraSeconds = new Map<string, number>()

  for (const stat of legacy) {
    merged.set(stat.date, {
      date: stat.date,
      pomodoros: Math.max(0, toFiniteNumber(stat.pomodoros)),
      focusMinutes: Math.max(0, toFiniteNumber(stat.focusMinutes)),
      tasksCompleted: Math.max(0, toFiniteNumber(stat.tasksCompleted)),
    })
  }

  for (const session of sessions) {
    if (session.status !== 'completed') continue
    const date = sessionLocalDate(session)
    const entry = merged.get(date) ?? {
      date,
      pomodoros: 0,
      focusMinutes: 0,
      tasksCompleted: 0,
    }
    entry.pomodoros += 1
    merged.set(date, entry)
    extraSeconds.set(date, (extraSeconds.get(date) ?? 0) + session.actualDuration)
  }

  for (const [date, seconds] of extraSeconds) {
    const entry = merged.get(date)
    if (entry) entry.focusMinutes += Math.round(seconds / 60)
  }

  return Array.from(merged.values()).sort((a, b) => a.date.localeCompare(b.date))
}
