import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ fetch: vi.fn() }))

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: h.fetch }))

import { fetchTronTodos, TronTodosError } from '../tronApi'

function jsonResponse(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

describe('fetchTronTodos 错误分类与解析', () => {
  beforeEach(() => {
    h.fetch.mockReset()
  })

  it('正常返回解析成待办，剔除缺 id 等非法条目', async () => {
    h.fetch.mockResolvedValue(jsonResponse(200, {
      ok: true,
      todos: [
        {
          id: 't1',
          title: ' 作业一 ',
          course: ' 高数 ',
          course_id: 'c1',
          type: 'homework',
          due: '2026-11-12 23:59',
          due_ts: '2026-11-12T23:59:00',
          hours_left: 20.5,
          overdue: false,
        },
        { title: '没有 id 的坏数据' },
        null,
        'junk',
      ],
    }))

    const todos = await fetchTronTodos()
    expect(todos).toHaveLength(1)
    expect(todos[0]).toMatchObject({
      id: 't1',
      title: '作业一',
      course: '高数',
      courseId: 'c1',
      hoursLeft: 20.5,
      overdue: false,
    })
  })

  it('hours_left 非法时置 null，缺标题兜底为未命名任务', async () => {
    h.fetch.mockResolvedValue(jsonResponse(200, {
      ok: true,
      todos: [{ id: 't2', hours_left: 'abc', overdue: 1 }],
    }))

    const todos = await fetchTronTodos()
    expect(todos[0]).toMatchObject({ id: 't2', title: '未命名任务', hoursLeft: null, overdue: true })
  })

  it.each([
    [401, 'auth_expired'],
    [502, 'upstream'],
    [500, 'server_error'],
    [503, 'bad_response'],
  ] as const)('HTTP %i 归类为 %s', async (status, kind) => {
    h.fetch.mockResolvedValue(jsonResponse(status, { ok: false }))

    const err = await fetchTronTodos().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(TronTodosError)
    expect((err as TronTodosError).kind).toBe(kind)
  })

  it('ok 字段不是 true 或 todos 不是数组 → bad_response', async () => {
    h.fetch.mockResolvedValue(jsonResponse(200, { ok: false, todos: 'nope' }))

    await expect(fetchTronTodos()).rejects.toMatchObject({ kind: 'bad_response' })
  })

  it('响应体不是 JSON → bad_response', async () => {
    h.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('not json')
      },
    })

    await expect(fetchTronTodos()).rejects.toMatchObject({ kind: 'bad_response' })
  })

  it('连不上服务 → unreachable', async () => {
    h.fetch.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(fetchTronTodos()).rejects.toMatchObject({ kind: 'unreachable' })
  })
})
