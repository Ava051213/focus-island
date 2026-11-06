import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

const h = vi.hoisted(() => ({
  files: new Map<string, string>(),
  todos: [] as Array<Record<string, unknown>>,
  fail: null as Error | null,
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppData: 'AppData' },
  exists: vi.fn(async (p: string) => h.files.has(p)),
  readTextFile: vi.fn(async (p: string) => {
    const value = h.files.get(p)
    if (value === undefined) throw new Error('ENOENT')
    return value
  }),
  writeTextFile: vi.fn(async (p: string, data: string) => {
    h.files.set(p, data)
  }),
  rename: vi.fn(async (from: string, to: string) => {
    const value = h.files.get(from)
    if (value === undefined) throw new Error('ENOENT')
    h.files.set(to, value)
    h.files.delete(from)
  }),
  copyFile: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {}),
}))

vi.mock('@tauri-apps/api/event', () => ({
  emitTo: vi.fn(async () => {}),
  listen: vi.fn(async () => () => {}),
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({ label: 'panel' }),
}))

vi.mock('../../utils/tronApi', () => ({
  fetchTronTodos: vi.fn(async () => {
    if (h.fail) throw h.fail
    return h.todos
  }),
  TronTodosError: class TronTodosError extends Error {
    kind: string
    constructor(kind: string, message: string) {
      super(message)
      this.name = 'TronTodosError'
      this.kind = kind
    }
  },
}))

function makeTodo(id: string, dueTs = ''): Record<string, unknown> {
  return {
    id,
    title: `作业 ${id}`,
    course: '课程',
    courseId: 'c1',
    type: 'homework',
    due: '',
    dueTs,
    hoursLeft: null,
    overdue: false,
  }
}

/** 让异步加载、请求链和 0ms 定时器都跑完 */
async function settle() {
  for (let i = 0; i < 6; i++) await Promise.resolve()
  await vi.advanceTimersByTimeAsync(0)
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

async function fresh() {
  vi.resetModules()
  const mod = await import('../useTronTodos')
  const api = mod.useTronTodos()
  await settle()
  const tronApi = await import('../../utils/tronApi')
  return { ...mod, api, fetchMock: vi.mocked(tronApi.fetchTronTodos), TronTodosError: tronApi.TronTodosError }
}

describe('useTronTodos', () => {
  beforeEach(() => {
    h.files.clear()
    h.todos = []
    h.fail = null
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 6, 12, 0, 0))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('首次调用就拉一次待办', async () => {
    h.todos = [makeTodo('a')]
    const { api, fetchMock } = await fresh()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(api.sortedTodos.value.map(todo => todo.id)).toEqual(['a'])
  })

  it('3 秒内重复刷新只发一次请求', async () => {
    h.todos = [makeTodo('a')]
    const { refreshTronTodos, fetchMock } = await fresh()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    void refreshTronTodos()
    void refreshTronTodos()
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(3100)
    void refreshTronTodos()
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('force 刷新不看 3 秒节流', async () => {
    h.todos = [makeTodo('a')]
    const { refreshTronTodos, fetchMock } = await fresh()

    void refreshTronTodos({ force: true })
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('同时在途的刷新共用同一个请求', async () => {
    h.todos = [makeTodo('a')]
    const { refreshTronTodos, fetchMock } = await fresh()

    const first = refreshTronTodos({ force: true })
    const second = refreshTronTodos({ force: true })
    expect(first).toBe(second)

    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('请求失败时保留上一次的列表并标 stale', async () => {
    h.todos = [makeTodo('a')]
    const { api, refreshTronTodos, TronTodosError } = await fresh()
    expect(api.sortedTodos.value).toHaveLength(1)
    expect(api.stale.value).toBe(false)

    h.fail = new TronTodosError('unreachable', '连不上待办服务')
    vi.advanceTimersByTime(3100)
    await refreshTronTodos()

    expect(api.sortedTodos.value).toHaveLength(1)
    expect(api.stale.value).toBe(true)
    expect(api.failure.value?.kind).toBe('unreachable')
    expect(api.lastSuccessAt.value).not.toBeNull()
  })

  it('从未成功过时失败不算 stale', async () => {
    h.fail = new Error('boom')
    const { api } = await fresh()

    expect(api.sortedTodos.value).toEqual([])
    expect(api.stale.value).toBe(false)
    expect(api.failure.value?.kind).toBe('bad_response')
  })

  it('按截止时间升序，没有截止的排最后', async () => {
    h.todos = [
      makeTodo('none'),
      makeTodo('late', '2026-11-09T12:00:00'),
      makeTodo('soon', '2026-11-07T12:00:00'),
    ]
    const { api } = await fresh()

    expect(api.sortedTodos.value.map(todo => todo.id)).toEqual(['soon', 'late', 'none'])
  })

  it('勾选归档后从列表移出，可以撤回', async () => {
    h.todos = [makeTodo('a'), makeTodo('b')]
    const { api } = await fresh()

    api.markTodoDone('a')
    expect(api.sortedTodos.value.map(todo => todo.id)).toEqual(['b'])
    expect(api.archivedTodos.value.map(todo => todo.id)).toEqual(['a'])

    api.restoreTodoDone('a')
    expect(api.sortedTodos.value.map(todo => todo.id)).toEqual(['a', 'b'])
    expect(api.archivedTodos.value).toEqual([])
  })

  it('归档写进 tron-todos-done.json', async () => {
    h.todos = [makeTodo('a')]
    const { api } = await fresh()

    api.markTodoDone('a')
    await nextTick()
    await vi.advanceTimersByTimeAsync(400)

    const saved = h.files.get('focus-island/tron-todos-done.json')
    expect(JSON.parse(saved ?? '[]')).toEqual(['a'])
  })

  it('启动时读取文件里已归档的条目', async () => {
    h.files.set('focus-island/tron-todos-done.json', '["a"]')
    h.todos = [makeTodo('a'), makeTodo('b')]
    const { api } = await fresh()

    expect(api.sortedTodos.value.map(todo => todo.id)).toEqual(['b'])
    expect(api.archivedTodos.value.map(todo => todo.id)).toEqual(['a'])
  })
})
