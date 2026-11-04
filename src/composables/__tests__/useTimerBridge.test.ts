import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  start: vi.fn(),
  append: vi.fn(() => true),
  sessions: [] as Array<Record<string, unknown>>,
  memos: [
    {
      id: 'm1',
      title: '写周报',
      content: '<p>写周报</p>',
      categoryId: '',
      isPinned: false,
      pomodoroCount: 0,
      createdAt: 1,
      updatedAt: 1,
      completedAt: null as number | null,
    },
  ],
}))

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(async () => {}),
  listen: vi.fn(async () => () => {}),
}))

vi.mock('../useMemos', async () => {
  const { ref } = await import('vue')
  return {
    useMemos: () => ({
      memos: ref(h.memos),
      getDisplayTitle: (memo: { title: string }) => memo.title,
      incrementPomodoro: vi.fn(),
    }),
  }
})

vi.mock('../useSessions', async () => {
  const { ref } = await import('vue')
  return {
    useSessions: () => ({
      sessions: ref(h.sessions),
      append: h.append,
      ensureLoaded: async () => {},
      loaded: ref(true),
    }),
  }
})

vi.mock('../useAchievements', () => ({
  useAchievements: () => ({
    recordPomodoro: vi.fn(),
    recordEarlyBird: vi.fn(),
    recordNightOwl: vi.fn(),
  }),
}))

vi.mock('../useSettings', async () => {
  const { ref } = await import('vue')
  return {
    useSettings: () => ({
      settings: ref({ focusDuration: 25, notifications: { enabled: true, sound: false } }),
    }),
  }
})

vi.mock('../useAiButler', () => ({
  useAiButler: () => ({ recordRound: vi.fn() }),
}))

vi.mock('../useTimerSnapshot', async () => {
  const { ref } = await import('vue')
  return {
    useTimerSnapshot: () => ({
      save: vi.fn(),
      clear: vi.fn(),
      ensureLoaded: async () => {},
      snapshot: ref({ kind: 'none', reason: 'missing' }),
    }),
  }
})

vi.mock('../useSystemNotify', () => ({
  notifyPhaseEnd: vi.fn(async () => true),
}))

vi.mock('../useTimer', async () => {
  const { ref } = await import('vue')
  return {
    useTimer: () => ({
      phase: ref('idle'),
      remaining: ref(0),
      totalDuration: ref(0),
      running: ref(false),
      status: ref('idle'),
      activeTaskId: ref<string | null>(null),
      activeTaskTitle: ref<string | null>(null),
      activeSubtaskId: ref<string | null>(null),
      activeSubtaskTitle: ref<string | null>(null),
      pendingNotification: ref(null),
      start: h.start,
      pause: vi.fn(),
      resume: vi.fn(),
      skipToBreak: vi.fn(),
      skipBreak: vi.fn(),
      abandon: vi.fn(),
      dismissNotification: vi.fn(),
      confirmNotification: vi.fn(),
      extendNotification: vi.fn(),
      restore: vi.fn(),
      getSnapshot: vi.fn(() => null),
      getRoundInfo: vi.fn(() => ({})),
      onPhaseEventCallback: vi.fn(),
    }),
  }
})

import { useTimerBridge } from '../useTimerBridge'

describe('useTimerBridge 开始与再来一轮', () => {
  beforeEach(() => {
    h.start.mockClear()
    h.append.mockClear()
    h.sessions.splice(0, h.sessions.length)
    h.memos[0].completedAt = null
  })

  it('不传任务时默认带上次 Session 里的备', () => {
    h.sessions.push({ id: 's1', taskId: 'm1', taskTitle: '写周报', endAt: 100, createdAt: 100 })
    const bridge = useTimerBridge()

    bridge.start(null)

    expect(h.start).toHaveBeenCalledWith('m1', '写周报')
  })

  it('上次备已完成时回退为不带任务开始', () => {
    h.sessions.push({ id: 's1', taskId: 'm1', taskTitle: '写周报', endAt: 100, createdAt: 100 })
    h.memos[0].completedAt = 200
    const bridge = useTimerBridge()

    bridge.start(null)

    expect(h.start).toHaveBeenCalledWith(null)
  })

  it('显式传入的备已不存在时回退为不带任务', () => {
    const bridge = useTimerBridge()

    bridge.start('missing')

    expect(h.start).toHaveBeenCalledWith(null)
  })

  it('再来一轮复用上次任务，且不写 Session', () => {
    h.sessions.push({ id: 's1', taskId: 'm1', taskTitle: '写周报', endAt: 100, createdAt: 100 })
    const bridge = useTimerBridge()

    expect(bridge.repeatLastRound()).toBe(true)
    expect(h.start).toHaveBeenCalledWith('m1', '写周报')
    expect(h.append).not.toHaveBeenCalled()
  })

  it('没有上次任务时再来一轮返回 false，不发任何开始调用', () => {
    const bridge = useTimerBridge()

    expect(bridge.repeatLastRound()).toBe(false)
    expect(h.start).not.toHaveBeenCalled()
  })
})
