import { fetch } from '@tauri-apps/plugin-http'

/** 本机 tronclass-picker 服务地址，换端口只改这一处 */
export const TRON_SERVICE_BASE = 'http://127.0.0.1:8765'

const TODOS_PATH = '/api/todos'
const REQUEST_TIMEOUT_MS = 8000

export interface TronTodo {
  id: string
  title: string
  course: string
  courseId: string
  type: string
  /** 给人看的截止时间，形如 `2026-11-03 23:59`；没有截止时间是空串 */
  due: string
  /** 本地时间，形如 `2026-11-03T23:59:00`，没有截止时间是空串 */
  dueTs: string
  hoursLeft: number | null
  overdue: boolean
}

export type TronTodosErrorKind =
  | 'auth_expired'
  | 'upstream'
  | 'server_error'
  | 'unreachable'
  | 'bad_response'

export class TronTodosError extends Error {
  kind: TronTodosErrorKind

  constructor(kind: TronTodosErrorKind, message: string) {
    super(message)
    this.name = 'TronTodosError'
    this.kind = kind
  }
}

function parseTodo(raw: unknown): TronTodo | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const id = String(item.id ?? '').trim()
  if (!id) return null
  const hoursLeft = item.hours_left
  return {
    id,
    title: String(item.title ?? '').trim() || '未命名任务',
    course: String(item.course ?? '').trim(),
    courseId: String(item.course_id ?? '').trim(),
    type: String(item.type ?? '').trim(),
    due: String(item.due ?? '').trim(),
    dueTs: String(item.due_ts ?? '').trim(),
    hoursLeft: typeof hoursLeft === 'number' && Number.isFinite(hoursLeft) ? hoursLeft : null,
    overdue: Boolean(item.overdue),
  }
}

/**
 * 唯一一处请求待办的薄封装：
 * 地址、超时、错误分类都在这里，换服务地址或端口只改 TRON_SERVICE_BASE。
 */
export async function fetchTronTodos(): Promise<TronTodo[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(`${TRON_SERVICE_BASE}${TODOS_PATH}`, {
      method: 'GET',
      connectTimeout: 4000,
      signal: controller.signal,
    })
  } catch {
    throw new TronTodosError(
      'unreachable',
      controller.signal.aborted
        ? '待办服务超过 8 秒没响应，看看它是不是卡住了'
        : '连不上待办服务，先在终端跑 python -m tronclass_picker --no-browser --no-scan',
    )
  } finally {
    clearTimeout(timer)
  }

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  const data = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>

  if (!response.ok) {
    if (response.status === 401) {
      throw new TronTodosError('auth_expired', '待办接口掉登录了，去畅课网页重新登录一次就好')
    }
    if (response.status === 502) {
      throw new TronTodosError('upstream', '畅课那边不太对劲，等会儿再刷新试试')
    }
    if (response.status === 500) {
      throw new TronTodosError('server_error', '待办服务自己出错了，看看它的终端日志')
    }
    throw new TronTodosError('bad_response', `待办接口返回了 ${response.status}`)
  }

  if (data.ok !== true || !Array.isArray(data.todos)) {
    throw new TronTodosError('bad_response', '待办接口返回的数据看不懂，稍后再试')
  }

  return data.todos
    .map(parseTodo)
    .filter((todo): todo is TronTodo => todo !== null)
}
