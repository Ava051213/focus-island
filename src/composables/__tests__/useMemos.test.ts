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
