import { ref } from 'vue'
import { createPersistedStore } from './persistence'
import {
  appendSession,
  mergeDailyStats,
  parseSessionList,
  type DailyTotals,
  type Session,
} from '../timer/sessions'

/** 专注轮次账本，是统计和恢复的唯一来源 */
const sessions = ref<Session[]>([])

const store = createPersistedStore({
  file: 'sessions.json',
  schemaVersion: 1,
  snapshot: () => sessions.value,
  restore: (data) => {
    if (!Array.isArray(data)) throw new Error('sessions.json is not an array')
    sessions.value = parseSessionList(data)
  },
})

export function useSessions() {
  void store.ensureLoaded()

  /** 同一轮重复调用只写第一条 */
  function append(session: Session): boolean {
    const result = appendSession(sessions.value, session)
    if (!result.appended) return false
    sessions.value = result.sessions
    return true
  }

  function mergeDaily(legacy: readonly DailyTotals[]): DailyTotals[] {
    return mergeDailyStats(legacy, sessions.value)
  }

  return {
    sessions,
    append,
    mergeDaily,
    loaded: store.loaded,
  }
}
