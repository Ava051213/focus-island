import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  let memoSeq = 0
  return {
    configured: { value: false },
    breakdownGoal: vi.fn(),
    extractEvent: vi.fn(),
    plan: { value: { entries: [] as Array<{ id: string; title: string }> } },
    regeneratePlan: vi.fn(async () => {}),
    moveEntry: vi.fn(),
    addEvent: vi.fn((payload: Record<string, unknown>) => ({ id: 'evt-1', ...payload })),
    memos: { value: [] as Array<Record<string, unknown>> },
    addMemo(categoryId = 'work') {
      memoSeq += 1
      const memo = {
        id: `new-${memoSeq}`,
        title: '',
        content: '',
        categoryId,
        isPinned: false,
        pomodoroCount: 0,
        estimatedPomodoros: 0,
        completedAt: null,
      }
      h.memos.value.unshift(memo)
      return memo
    },
    completeMemo(id: string) {
      const memo = h.memos.value.find(m => m.id === id)
      if (memo) memo.completedAt = Date.now()
    },
  }
})

vi.mock('../useAi', () => ({
  useAi: () => ({
    configured: h.configured,
    breakdownGoal: h.breakdownGoal,
    extractEvent: h.extractEvent,
  }),
}))

vi.mock('../useTodayPlan', () => ({
  useTodayPlan: () => ({
    plan: h.plan,
    regeneratePlan: h.regeneratePlan,
    moveEntry: h.moveEntry,
  }),
}))

vi.mock('../useMemos', () => ({
  useMemos: () => ({
    memos: h.memos,
    activeMemos: h.memos,
    addMemo: h.addMemo,
    completeMemo: h.completeMemo,
  }),
}))

vi.mock('../useEvents', async importOriginal => {
  const actual = await importOriginal<typeof import('../useEvents')>()
  return { ...actual, useEvents: () => ({ addEvent: h.addEvent }) }
})

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppData: 'AppData' },
  exists: vi.fn(async () => false),
  readTextFile: vi.fn(async () => ''),
  writeTextFile: vi.fn(async () => {}),
  rename: vi.fn(async () => {}),
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

async function fresh() {
  vi.resetModules()
  const { useInstructions } = await import('../useInstructions')
  return useInstructions()
}

describe('useInstructions 提案生命周期', () => {
  beforeEach(() => {
    h.configured.value = false
    h.plan.value = { entries: [] }
    h.memos.value = []
    h.breakdownGoal.mockReset()
    h.extractEvent.mockReset()
    h.moveEntry.mockReset()
    h.addEvent.mockClear()
    h.regeneratePlan.mockClear()
  })

  it('调顺序：提案后确认才真正移动', async () => {
    h.plan.value = { entries: [{ id: 'e1', title: '写数学作业' }] }
    const ins = await fresh()

    expect(await ins.submit('把写数学作业放到最后')).toBe('proposal')
    expect(ins.proposal.value).toMatchObject({ kind: 'move', entryId: 'e1', position: 'bottom' })
    expect(h.moveEntry).not.toHaveBeenCalled()

    await ins.confirm()
    expect(h.moveEntry).toHaveBeenCalledWith('e1', 'bottom')
    expect(ins.result.value).toContain('放到最后')
    expect(ins.proposal.value).toBeNull()
  })

  it('目标不在安排里：给出可读原因，不出提案', async () => {
    h.plan.value = { entries: [{ id: 'e1', title: '写数学作业' }] }
    const ins = await fresh()

    expect(await ins.submit('把不存在的事放到最后')).toBe('rejected')
    expect(ins.proposal.value).toBeNull()
    expect(ins.result.value).not.toBe('')
  })

  it('「早晚各一次」纯本地拆分：确认后建两条并收起原小记', async () => {
    h.memos.value = [{
      id: 'm1', title: '背单词', content: '', categoryId: 'work',
      estimatedPomodoros: 4, completedAt: null,
    }]
    const ins = await fresh()

    expect(await ins.submit('背单词拆成早晚各一次')).toBe('proposal')
    expect(ins.proposal.value).toMatchObject({
      kind: 'split',
      memoId: 'm1',
      parts: ['背单词·早', '背单词·晚'],
    })

    await ins.confirm()
    const created = h.memos.value.filter(memo => String(memo.id).startsWith('new-'))
    // addMemo 是 unshift，列表里倒序出现，按名字比对拆分结果
    expect(created.map(memo => memo.title).sort()).toEqual(['背单词·早', '背单词·晚'])
    // 原小记估了 4 个番茄，拆两条各分 2 个
    expect(created.map(memo => memo.estimatedPomodoros)).toEqual([2, 2])
    expect(h.memos.value.find(memo => memo.id === 'm1')?.completedAt).not.toBeNull()
    expect(h.regeneratePlan).toHaveBeenCalledTimes(1)
  })

  it('通用拆分没 Key 时明确拒绝并提示', async () => {
    h.memos.value = [{ id: 'm1', title: '背单词', estimatedPomodoros: 0, completedAt: null }]
    const ins = await fresh()

    expect(await ins.submit('把背单词拆开')).toBe('rejected')
    expect(ins.result.value).toContain('Key')
  })

  it('通用拆分有 Key 时走 AI，返回几条拆几条', async () => {
    h.configured.value = true
    h.breakdownGoal.mockResolvedValue(['第一步', '第二步', '第三步'])
    h.memos.value = [{ id: 'm1', title: '背单词', estimatedPomodoros: 0, completedAt: null }]
    const ins = await fresh()

    expect(await ins.submit('把背单词拆开')).toBe('proposal')
    expect(h.breakdownGoal).toHaveBeenCalledTimes(1)
    expect(ins.proposal.value).toMatchObject({ kind: 'split', memoId: 'm1' })
    expect((ins.proposal.value as { parts: string[] }).parts).toHaveLength(3)
  })

  it('加日程：本地能算出时刻就直接提案，确认写入日程', async () => {
    const ins = await fresh()

    expect(await ins.submit('明天 3 点提醒我交作业')).toBe('proposal')
    expect(ins.proposal.value?.kind).toBe('event')
    expect(h.extractEvent).not.toHaveBeenCalled()

    await ins.confirm()
    expect(h.addEvent).toHaveBeenCalledTimes(1)
    expect(String(h.addEvent.mock.calls[0][0].at)).toContain('T')
    expect(ins.result.value).toContain('已建好')
  })

  it('本地算不出时刻且有 Key：交给模型，失败退回本地结果', async () => {
    h.configured.value = true
    h.extractEvent.mockRejectedValue(new Error('超时'))
    const ins = await fresh()

    expect(await ins.submit('记得明天交作业')).toBe('proposal')
    expect(h.extractEvent).toHaveBeenCalledTimes(1)
    expect(ins.proposal.value?.kind).toBe('event')

    await ins.confirm()
    expect(h.addEvent).toHaveBeenCalledTimes(1)
  })

  it('不是指令的话当闲聊处理', async () => {
    const ins = await fresh()
    expect(await ins.submit('今天好累啊')).toBe('chat')
    expect(ins.proposal.value).toBeNull()
  })

  it('取消提案不写任何数据', async () => {
    h.plan.value = { entries: [{ id: 'e1', title: '写数学作业' }] }
    const ins = await fresh()

    await ins.submit('把写数学作业放到最后')
    ins.cancel()

    expect(ins.proposal.value).toBeNull()
    expect(ins.result.value).toBe('')
    expect(h.moveEntry).not.toHaveBeenCalled()
  })
})
