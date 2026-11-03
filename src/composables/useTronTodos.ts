import { computed, ref } from 'vue'
import { listen } from '@tauri-apps/api/event'
import {
  fetchTronTodos,
  TronTodosError,
  type TronTodo,
  type TronTodosErrorKind,
} from '../utils/tronApi'
import { eventRelativeLabel, eventsNow } from './useEvents'
import { toLocalDateStr } from '../utils/date'

/** 服务端有 3 秒缓存，自动刷新不要比这更频繁 */
const MIN_REQUEST_INTERVAL_MS = 3000
const AUTO_REFRESH_MS = 5 * 60 * 1000

const todos = ref<TronTodo[]>([])
const loading = ref(false)
const failure = ref<{ kind: TronTodosErrorKind; message: string } | null>(null)
const lastSuccessAt = ref<number | null>(null)

let watchersStarted = false
let inflight: Promise<void> | null = null
let lastRequestAt = 0

async function requestTodos(force: boolean) {
  const now = Date.now()
  if (!force && now - lastRequestAt < MIN_REQUEST_INTERVAL_MS) return
  lastRequestAt = now
  loading.value = true
  try {
    todos.value = await fetchTronTodos()
    failure.value = null
    lastSuccessAt.value = Date.now()
  } catch (e) {
    // 失败不动列表：保留上一次成功拉到的数据，交给界面标注「可能过期」
    failure.value = e instanceof TronTodosError
      ? { kind: e.kind, message: e.message }
      : { kind: 'bad_response', message: '待办没拉下来，稍后再试' }
  } finally {
    loading.value = false
  }
}

/** force 用于手动下拉刷新：不看 3 秒节流，直接打；仍在进行中的请求直接复用 */
export function refreshTronTodos(options: { force?: boolean } = {}): Promise<void> {
  if (inflight) return inflight
  inflight = requestTodos(Boolean(options.force)).finally(() => {
    inflight = null
  })
  return inflight
}

function startWatchers() {
  if (watchersStarted) return
  watchersStarted = true

  // 日程页第一次打开时就算「进前台」，先拉一次
  void refreshTronTodos({ force: true })

  window.addEventListener('focus', () => {
    void refreshTronTodos()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshTronTodos()
  })
  // 面板重新弹出时也算进前台；KeepAlive 缓存了页面时窗口事件不一定触发
  listen<string>('panel-window-transition', ({ payload }) => {
    if (String(payload ?? '') === 'open') void refreshTronTodos()
  }).catch(() => {})

  setInterval(() => {
    if (document.visibilityState === 'visible') void refreshTronTodos()
  }, AUTO_REFRESH_MS)
}

export function todoDueMs(todo: TronTodo): number | null {
  if (!todo.dueTs) return null
  // due_ts 没有时区后缀，按本地时间解析就是对的
  const ms = new Date(todo.dueTs).getTime()
  return Number.isNaN(ms) ? null : ms
}

function durationLabel(ms: number): string {
  const hours = Math.max(0, ms / 3_600_000)
  if (hours < 48) return `${hours.toFixed(1)} 小时`
  return `${Math.floor(hours / 24)} 天`
}

/** 不足 48 小时用小时，否则用天；没有截止时间单独说 */
export function todoRemainingLabel(todo: TronTodo, nowMs: number = Date.now()): string {
  const due = todoDueMs(todo)
  if (due === null) return '无截止时间'
  const diff = due - nowMs
  return diff <= 0 ? `已过期 ${durationLabel(-diff)}` : `剩 ${durationLabel(diff)}`
}

export function todoDueDate(todo: TronTodo): string {
  return (todo.dueTs || todo.due).slice(0, 10)
}

export function todoIsOverdue(todo: TronTodo, nowMs: number = Date.now()): boolean {
  const due = todoDueMs(todo)
  return due !== null && due <= nowMs
}

export function todoIsDueToday(todo: TronTodo, nowMs: number = Date.now()): boolean {
  const date = todoDueDate(todo)
  return !!date && date === toLocalDateStr(new Date(nowMs))
}

export function todoDueLabel(todo: TronTodo): string {
  if (!todo.dueTs && !todo.due) return ''
  const at = (todo.dueTs || todo.due).replace(' ', 'T')
  const relative = eventRelativeLabel(at)
  const time = at.slice(11, 16)
  if (!time) return relative
  return relative ? `${relative} ${time}` : time
}

export function useTronTodos() {
  startWatchers()

  /** 按 due_ts 升序；没有截止时间的排最后 */
  const sortedTodos = computed(() =>
    todos.value.slice().sort((a, b) => {
      const aDue = todoDueMs(a)
      const bDue = todoDueMs(b)
      if (aDue === null && bDue === null) return 0
      if (aDue === null) return 1
      if (bDue === null) return -1
      return aDue - bDue
    }),
  )

  /** 有失败但手里还有上一次成功的列表 */
  const stale = computed(() => failure.value !== null && lastSuccessAt.value !== null)

  const lastSuccessLabel = computed(() => {
    if (lastSuccessAt.value === null) return ''
    const date = new Date(lastSuccessAt.value)
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  })

  return {
    todos,
    sortedTodos,
    loading,
    failure,
    stale,
    lastSuccessAt,
    lastSuccessLabel,
    now: eventsNow,
  }
}
