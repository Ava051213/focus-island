import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { createPersistedStore } from '../persistence'

const h = vi.hoisted(() => ({
  files: new Map<string, string>(),
  copyShouldFail: false,
  copies: 0,
  listens: [] as Array<(e: { payload: string }) => void>,
  emits: [] as Array<{ event: string; payload: string }>,
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppData: 'AppData' },
  exists: vi.fn(async (p: string) => h.files.has(p)),
  readTextFile: vi.fn(async (p: string) => {
    const v = h.files.get(p)
    if (v === undefined) throw new Error('ENOENT')
    return v
  }),
  writeTextFile: vi.fn(async (p: string, data: string) => {
    h.files.set(p, data)
  }),
  rename: vi.fn(async (from: string, to: string) => {
    const v = h.files.get(from)
    if (v === undefined) throw new Error('ENOENT')
    h.files.set(to, v)
    h.files.delete(from)
  }),
  copyFile: vi.fn(async (from: string, to: string) => {
    if (h.copyShouldFail) throw new Error('copy failed')
    h.copies++
    const v = h.files.get(from)
    if (v !== undefined) h.files.set(to, v)
  }),
  mkdir: vi.fn(async () => {}),
}))

vi.mock('@tauri-apps/api/event', () => ({
  emitTo: vi.fn(async (_target: string, event: string, payload: string) => {
    h.emits.push({ event, payload })
  }),
  listen: vi.fn(async (_event: string, cb: (e: { payload: string }) => void) => {
    h.listens.push(cb)
    return () => {}
  }),
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({ label: 'panel' }),
}))

const FILE = 'focus-island/data.json'
const TMP = `${FILE}.panel.tmp`

describe('createPersistedStore', () => {
  beforeEach(() => {
    h.files.clear()
    h.listens.length = 0
    h.emits.length = 0
    h.copies = 0
    h.copyShouldFail = false
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('文件不存在时正常启动，不抛错', async () => {
    const data = ref({ value: 1 })
    const store = createPersistedStore({
      file: 'data.json',
      snapshot: () => data.value,
      restore: () => {},
    })

    await expect(store.ensureLoaded()).resolves.toBeUndefined()
    expect(store.loaded.value).toBe(true)
  })

  it('restore 抛错时先备份原文件，再允许后续写入', async () => {
    h.files.set(FILE, '{"broken":true}')
    const data = ref({ value: 1 })
    const store = createPersistedStore({
      file: 'data.json',
      snapshot: () => data.value,
      // 模拟校验失败
      restore: () => {
        throw new Error('invalid')
      },
    })

    await store.ensureLoaded()

    expect(h.copies).toBe(1)
    // 原文件在备份阶段不能被清空或覆盖
    expect(h.files.get(FILE)).toBe('{"broken":true}')

    data.value = { value: 2 }
    await nextTick()
    await vi.advanceTimersByTimeAsync(300)

    expect(JSON.parse(h.files.get(FILE)!)).toEqual({ value: 2 })
  })

  it('备份失败时本次会话禁止写入，避免毁掉唯一副本', async () => {
    h.files.set(FILE, '{"broken":true}')
    h.copyShouldFail = true
    const data = ref({ value: 1 })
    const store = createPersistedStore({
      file: 'data.json',
      snapshot: () => data.value,
      restore: () => {
        throw new Error('invalid')
      },
    })

    await store.ensureLoaded()

    data.value = { value: 2 }
    await nextTick()
    await vi.advanceTimersByTimeAsync(300)

    // 原文件保持原样，没有被新数据覆盖
    expect(h.files.get(FILE)).toBe('{"broken":true}')
  })

  it('快照没有变化时不写盘也不广播', async () => {
    const data = ref({ value: 1 })
    const store = createPersistedStore({
      file: 'data.json',
      snapshot: () => data.value,
      restore: () => {},
      syncEvent: 'data-updated',
    })
    await store.ensureLoaded()

    await nextTick()
    await vi.advanceTimersByTimeAsync(300)

    expect(h.files.has(FILE)).toBe(false)
    expect(h.emits).toHaveLength(0)
  })

  it('写入走 .tmp + rename，成功后不残留临时文件', async () => {
    const data = ref({ value: 1 })
    const store = createPersistedStore({
      file: 'data.json',
      snapshot: () => data.value,
      restore: () => {},
    })
    await store.ensureLoaded()

    data.value = { value: 2 }
    await nextTick()
    await vi.advanceTimersByTimeAsync(300)

    expect(h.files.has(FILE)).toBe(true)
    expect(h.files.has(TMP)).toBe(false)
    expect(h.emits).toHaveLength(0)
  })

  it('配置 syncEvent 时改动会镜像到另一个窗口', async () => {
    const data = ref({ value: 1 })
    const store = createPersistedStore({
      file: 'data.json',
      snapshot: () => data.value,
      restore: () => {},
      syncEvent: 'data-updated',
    })
    await store.ensureLoaded()

    data.value = { value: 2 }
    await nextTick()
    await vi.advanceTimersByTimeAsync(300)

    expect(h.emits).toEqual([{ event: 'data-updated', payload: '{"value":2}' }])
  })

  it('收到另一个窗口的合法数据时应用它', async () => {
    const data = ref({ value: 1 })
    createPersistedStore({
      file: 'data.json',
      snapshot: () => data.value,
      restore: (raw) => {
        data.value = raw as { value: number }
      },
      syncEvent: 'data-updated',
    })
    await nextTick()

    expect(h.listens).toHaveLength(1)
    h.listens[0]({ payload: '{"value":42}' })

    expect(data.value).toEqual({ value: 42 })
  })

  it('收到非法跨窗口数据时不崩溃，状态保持不变', async () => {
    const data = ref({ value: 1 })
    const store = createPersistedStore({
      file: 'data.json',
      snapshot: () => data.value,
      restore: (raw) => {
        if (typeof raw !== 'object' || raw === null) throw new Error('invalid')
        data.value = raw as { value: number }
      },
      syncEvent: 'data-updated',
    })
    await nextTick()

    expect(() => h.listens[0]({ payload: 'null' })).not.toThrow()
    expect(data.value).toEqual({ value: 1 })
    expect(store.loaded.value).toBe(false)
  })
})
