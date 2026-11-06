// @vitest-environment jsdom
// 粘贴路径要过 DOMPurify，happy-dom 下清洗会失效，这里用 jsdom
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MemoEditor from '../MemoEditor.vue'
import type { Memo, MemoCategory } from '../../composables/useMemos'

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  readText: vi.fn(async () => ''),
}))

vi.mock('../../composables/useAi', () => ({
  useAi: () => ({
    polishMemo: vi.fn(async () => ({ title: '整理后的标题', content: '整理后的正文' })),
  }),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppData: 'AppData' },
  exists: vi.fn(async () => false),
  readTextFile: vi.fn(async () => '[]'),
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

const memo: Memo = {
  id: 'm1',
  title: '原标题',
  content: '<p>原正文</p>',
  categoryId: 'work',
  isPinned: false,
  pomodoroCount: 0,
  estimatedPomodoros: 0,
  order: 0,
  completedAt: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
}

const categories: MemoCategory[] = [
  { id: 'work', name: '工作', icon: 'folder', color: 'blue', isDefault: true, order: 1 },
]

function mountEditor() {
  return mount(MemoEditor, { props: { memo, categories } })
}

/** 从 emit 里取最后一次 update 的 patch */
function lastPatch(wrapper: ReturnType<typeof mountEditor>): Record<string, unknown> | undefined {
  const updates = wrapper.emitted('update')
  if (!updates || updates.length === 0) return undefined
  return updates[updates.length - 1][0] as Record<string, unknown>
}

describe('MemoEditor', () => {
  beforeEach(() => {
    // happy-dom 没有实现 execCommand 这一套，按调用情况打桩
    document.execCommand = vi.fn(() => true) as unknown as typeof document.execCommand
    document.queryCommandState = vi.fn(() => false) as unknown as typeof document.queryCommandState
    document.queryCommandValue = vi.fn(() => '') as unknown as typeof document.queryCommandValue
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('挂载后把正文渲染进可编辑区', () => {
    const wrapper = mountEditor()

    expect(wrapper.find('.editor-content').element.innerHTML).toContain('原正文')
    expect(wrapper.find('.editor-toolbar').exists()).toBe(true)
    expect(wrapper.find('.editor-bottom').exists()).toBe(true)
  })

  it('点工具栏加粗会执行 bold 命令并标记为已改动', async () => {
    const wrapper = mountEditor()

    await wrapper.find('.editor-toolbar .toolbar-btn').trigger('click')

    expect(document.execCommand).toHaveBeenCalledWith('bold', false, undefined)
  })

  it('输入内容后 10 秒才写回一次，内容是编辑器里的 HTML', async () => {
    vi.useFakeTimers()
    const wrapper = mountEditor()
    const editor = wrapper.find('.editor-content')

    editor.element.innerHTML = '<p>改过的内容</p>'
    await editor.trigger('input')

    await vi.advanceTimersByTimeAsync(9999)
    expect(wrapper.emitted('update')).toBeUndefined()

    await vi.advanceTimersByTimeAsync(1)
    const patch = lastPatch(wrapper)
    expect(patch?.content).toBe('<p>改过的内容</p>')
    expect(patch?.title).toBe('原标题')
  })

  it('连续输入会重新计时，不会中途落库', async () => {
    vi.useFakeTimers()
    const wrapper = mountEditor()
    const editor = wrapper.find('.editor-content')

    editor.element.innerHTML = '<p>第一段</p>'
    await editor.trigger('input')
    await vi.advanceTimersByTimeAsync(6000)

    editor.element.innerHTML = '<p>第二段</p>'
    await editor.trigger('input')
    await vi.advanceTimersByTimeAsync(6000)
    expect(wrapper.emitted('update')).toBeUndefined()

    await vi.advanceTimersByTimeAsync(4000)
    expect(lastPatch(wrapper)?.content).toBe('<p>第二段</p>')
  })

  it('点复选框会同步 checked 属性并触发保存', async () => {
    vi.useFakeTimers()
    const wrapper = mountEditor()
    const editor = wrapper.find('.editor-content')

    editor.element.innerHTML = '<div class="memo-checkbox-item"><input type="checkbox" class="memo-checkbox"><span class="memo-checkbox-text">待办</span></div>'
    const checkbox = editor.element.querySelector('.memo-checkbox') as HTMLInputElement
    checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    // 点完勾上之后，属性要和 checked 保持一致，样式才跟得上
    expect(checkbox.checked).toBe(true)
    expect(checkbox.hasAttribute('checked')).toBe(true)

    await vi.advanceTimersByTimeAsync(10000)
    expect(lastPatch(wrapper)?.content).toContain('memo-checkbox')
  })

  it('粘贴富文本会先过一遍清洗', async () => {
    const wrapper = mountEditor()
    const editor = wrapper.find('.editor-content')

    const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(paste, 'clipboardData', {
      value: {
        items: [],
        getData: (type: string) =>
          type === 'text/html' ? '<p>带格式<script>alert(1)</script></p>' : '',
      },
    })
    editor.element.dispatchEvent(paste)

    const calls = vi.mocked(document.execCommand).mock.calls
    const inserted = calls.find(call => call[0] === 'insertHTML')
    expect(inserted).toBeTruthy()
    expect(String(inserted?.[2])).not.toContain('script')
    expect(String(inserted?.[2])).toContain('带格式')
  })

  it('删除要先确认', async () => {
    const wrapper = mountEditor()

    await wrapper.find('.delete-btn').trigger('click')
    expect(wrapper.find('.delete-dialog').exists()).toBe(true)
    expect(wrapper.emitted('delete')).toBeUndefined()

    await wrapper.find('.confirm-btn').trigger('click')
    expect(wrapper.emitted('delete')).toHaveLength(1)
    expect(wrapper.find('.delete-dialog').exists()).toBe(false)
  })

  it('卸载时补存一次，最后的编辑不丢', async () => {
    const wrapper = mountEditor()
    const editor = wrapper.find('.editor-content')

    editor.element.innerHTML = '<p>还没到 10 秒</p>'
    await editor.trigger('input')

    wrapper.unmount()

    expect(lastPatch(wrapper)?.content).toBe('<p>还没到 10 秒</p>')
  })

  it('Shift+回车交给 AI 整理，整理完存回并发返回事件', async () => {
    const wrapper = mountEditor()
    const editor = wrapper.find('.editor-content')
    Object.defineProperty(editor.element, 'innerText', {
      value: '随手写的碎片',
      configurable: true,
    })

    await editor.trigger('keydown', { key: 'Enter', shiftKey: true })

    await vi.waitFor(() => {
      expect(wrapper.emitted('update')).toBeTruthy()
    })
    const patch = lastPatch(wrapper)
    expect(patch?.title).toBe('整理后的标题')
    expect(String(patch?.content)).toContain('整理后的正文')
    expect(wrapper.emitted('back')?.[0]).toEqual([false])
  })

  it('正文空着时按 Shift+回车只提示，不调 AI', async () => {
    const wrapper = mountEditor()
    const editor = wrapper.find('.editor-content')
    editor.element.innerHTML = ''
    Object.defineProperty(editor.element, 'innerText', { value: '   ', configurable: true })

    await editor.trigger('keydown', { key: 'Enter', shiftKey: true })

    expect(wrapper.emitted('update')).toBeUndefined()
    expect(wrapper.text()).toContain('先写点什么')
  })

  it('返回时先存再告诉外面有没有内容', async () => {
    const wrapper = mountEditor()

    await wrapper.find('.back-btn').trigger('click')

    expect(lastPatch(wrapper)?.title).toBe('原标题')
    expect(wrapper.emitted('back')?.[0]).toEqual([false])
  })

  it('内容全空时返回 isEmpty 为 true', async () => {
    const empty: Memo = { ...memo, title: '', content: '' }
    const wrapper = mount(MemoEditor, { props: { memo: empty, categories } })

    await wrapper.find('.back-btn').trigger('click')

    expect(wrapper.emitted('back')?.[0]).toEqual([true])
  })
})
