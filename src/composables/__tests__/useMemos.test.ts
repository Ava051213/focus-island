import { describe, expect, it, vi } from 'vitest'

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

// 备忘状态是模块级单例，每个用例重新加载模块图
async function freshMemos() {
  vi.resetModules()
  const { useMemos } = await import('../useMemos')
  return useMemos()
}

describe('useMemos addQuickMemo', () => {
  it('保存一句话，标题取正文前几个字', async () => {
    const memos = await freshMemos()
    const created = memos.addQuickMemo('  明天要记得交报告  ')

    expect(created?.title).toBe('明天要记得交报告')
    expect(created?.content).toBe('<p>明天要记得交报告</p>')
    expect(memos.activeMemos.value[0]?.id).toBe(created?.id)
  })

  it('空白输入不创建', async () => {
    const memos = await freshMemos()

    expect(memos.addQuickMemo('   ')).toBeNull()
  })

  it('转义 HTML 符号并按换行分段', async () => {
    const memos = await freshMemos()
    const created = memos.addQuickMemo('a < b\n第二行')

    expect(created?.content).toBe('<p>a &lt; b</p><p>第二行</p>')
  })

  it('标题重复时允许创建两条独立备忘，不静默去重', async () => {
    const memos = await freshMemos()
    const first = memos.addQuickMemo('买牛奶')
    const second = memos.addQuickMemo('买牛奶')

    expect(first?.title).toBe('买牛奶')
    expect(second?.title).toBe('买牛奶')
    expect(first?.id).not.toBe(second?.id)
    expect(memos.activeMemos.value).toHaveLength(2)
  })
})

describe('useMemos 主流程', () => {
  it('完成归档：completedAt 记时间，从进行中列表消失，可恢复', async () => {
    const memos = await freshMemos()
    const memo = memos.addQuickMemo('交房租')
    memos.completeMemo(memo!.id)

    expect(memo?.completedAt).not.toBeNull()
    expect(memos.activeMemos.value).toHaveLength(0)
    expect(memos.memos.value).toHaveLength(1)

    memos.restoreMemo(memo!.id)
    expect(memos.activeMemos.value).toHaveLength(1)
  })

  it('完成重复调用是幂等的，不会覆盖第一次的时间', async () => {
    const memos = await freshMemos()
    const memo = memos.addQuickMemo('交房租')
    memos.completeMemo(memo!.id)
    const first = memo!.completedAt
    memos.completeMemo(memo!.id)

    expect(memo?.completedAt).toBe(first)
  })

  it('置顶后排在最前，取消后回到普通组最前', async () => {
    const memos = await freshMemos()
    const a = memos.addQuickMemo('第一条')
    const b = memos.addQuickMemo('第二条')
    memos.togglePin(b!.id)

    expect(memos.activeMemos.value[0]?.id).toBe(b!.id)
    expect(b?.isPinned).toBe(true)

    memos.togglePin(b!.id)
    expect(b?.isPinned).toBe(false)
    // 取消钉住后回到普通组的最前（与实现的注释约定一致）
    expect(memos.activeMemos.value[0]?.id).toBe(b!.id)
    expect(memos.activeMemos.value[1]?.id).toBe(a!.id)
  })

  it('updateMemo 打补丁并刷新 updatedAt，目标不存在时不动', async () => {
    const memos = await freshMemos()
    const memo = memos.addQuickMemo('原始')
    const before = memo!.updatedAt

    memos.updateMemo(memo!.id, { title: '改好了', estimatedPomodoros: 3 })
    expect(memo?.title).toBe('改好了')
    expect(memo?.estimatedPomodoros).toBe(3)
    expect(memo!.updatedAt).toBeGreaterThanOrEqual(before)

    expect(() => memos.updateMemo('no-such-id', { title: 'x' })).not.toThrow()
  })

  it('专注一轮累加番茄数，未知 id 静默跳过', async () => {
    const memos = await freshMemos()
    const memo = memos.addQuickMemo('背单词')
    memos.incrementPomodoro(memo!.id)
    memos.incrementPomodoro(memo!.id)

    expect(memo?.pomodoroCount).toBe(2)
    expect(() => memos.incrementPomodoro('no-such-id')).not.toThrow()
  })

  it('deleteMemo 移除条目', async () => {
    const memos = await freshMemos()
    const memo = memos.addQuickMemo('要删掉的')
    memos.deleteMemo(memo!.id)

    expect(memos.memos.value).toHaveLength(0)
  })
})
