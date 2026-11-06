import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import type { TronTodo } from '../../utils/tronApi'

const h = vi.hoisted(() => ({
  files: new Map<string, string>(),
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

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(async () => {
    throw new Error('测试里不应真的发请求')
  }),
}))

const COURSE = '数据结构'

function makeTodo(id: string, hoursLeft = 3): TronTodo {
  const due = new Date(Date.now() + hoursLeft * 3600e3)
  return {
    id,
    title: `作业 ${id}`,
    course: COURSE,
    courseId: 'c1',
    type: 'homework',
    due: '',
    dueTs: due.toISOString(),
    hoursLeft: null,
    overdue: false,
  }
}

async function fresh() {
  vi.resetModules()
  const { useMemos } = await import('../useMemos')
  const { useTronMemo } = await import('../useTronMemo')
  return { memos: useMemos(), tron: useTronMemo() }
}

describe('useTronMemo convert', () => {
  beforeEach(() => {
    h.files.clear()
    vi.resetModules()
  })

  it('转成小记：标题带课程前缀，正文带剩余时间，进「工作」分类', async () => {
    const { memos, tron } = await fresh()
    const result = tron.convert(makeTodo('t1'))

    expect(result.created).toBe(true)
    expect(result.memo.title).toBe(`${COURSE}·作业 t1`)
    expect(result.memo.categoryId).toBe('work')
    expect(result.memo.content).toContain('课程待办')
    expect(result.memo.content).toContain('剩 3.0 小时')
    expect(memos.activeMemos.value).toHaveLength(1)
  })

  it('同一条待办转两次只生成一条小记', async () => {
    const { memos, tron } = await fresh()
    const todo = makeTodo('t1')

    const first = tron.convert(todo)
    const second = tron.convert(todo)

    expect(second.created).toBe(false)
    expect(second.memo.id).toBe(first.memo.id)
    expect(memos.activeMemos.value).toHaveLength(1)
  })

  it('没有映射的老数据按标题认出来，不重复建', async () => {
    const { memos, tron } = await fresh()
    const legacy = memos.addMemo('work')
    memos.updateMemo(legacy.id, { title: `${COURSE}·作业 t1` })

    const todo = makeTodo('t1')
    expect(tron.isConverted(todo)).toBe(true)

    const result = tron.convert(todo)
    expect(result.created).toBe(false)
    expect(result.memo.id).toBe(legacy.id)
    expect(memos.activeMemos.value).toHaveLength(1)
  })

  it('小记完成归档后允许重新转一次', async () => {
    const { memos, tron } = await fresh()
    const todo = makeTodo('t1')

    const first = tron.convert(todo)
    memos.completeMemo(first.memo.id)
    expect(tron.isConverted(todo)).toBe(false)

    const again = tron.convert(todo)
    expect(again.created).toBe(true)
    expect(again.memo.id).not.toBe(first.memo.id)
  })

  it('映射写进 tron-memo-links.json，重新打开也能认出转过', async () => {
    const { tron } = await fresh()
    // 写入只在 store 加载完成后才生效，先等加载
    await new Promise(resolve => setTimeout(resolve, 10))

    tron.convert(makeTodo('t1'))
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 400))

    const saved = h.files.get('focus-island/tron-memo-links.json')
    expect(saved).toBeTruthy()
    expect(JSON.parse(saved ?? '[]')).toEqual([
      { todoId: 't1', memoId: expect.any(String), at: expect.any(Number) },
    ])

    vi.resetModules()
    const { useTronMemo } = await import('../useTronMemo')
    const again = useTronMemo()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(again.isConverted(makeTodo('t1'))).toBe(true)
  })

  it('损坏的映射文件按空列表处理，不影响新建', async () => {
    h.files.set('focus-island/tron-memo-links.json', '{"not":"an array"}')
    const { memos, tron } = await fresh()
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(tron.isConverted(makeTodo('t1'))).toBe(false)
    expect(tron.convert(makeTodo('t1')).created).toBe(true)
    expect(memos.activeMemos.value).toHaveLength(1)
  })
})
