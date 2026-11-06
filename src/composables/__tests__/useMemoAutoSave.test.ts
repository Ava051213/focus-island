import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { useMemoAutoSave, type MemoPatch } from '../useMemoAutoSave'

type Api = ReturnType<typeof useMemoAutoSave>

function mountHost() {
  const commits: MemoPatch[] = []
  let api!: Api

  const Host = defineComponent({
    setup() {
      api = useMemoAutoSave({
        collect: () => ({ title: '标题', content: '<p>正文</p>' }),
        commit: patch => commits.push(patch),
      })
      return () => h('div')
    },
  })

  const wrapper = mount(Host)
  return { wrapper, commits, api }
}

describe('useMemoAutoSave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('停手 2 秒先显示未保存，10 秒才真正写回', async () => {
    const { api, commits } = mountHost()

    api.schedule()
    await vi.advanceTimersByTimeAsync(1999)
    expect(api.saveStatus.value).toBe('saved')

    await vi.advanceTimersByTimeAsync(1)
    expect(api.saveStatus.value).toBe('unsaved')
    expect(commits).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(8000)
    expect(commits).toHaveLength(1)
    expect(commits[0].title).toBe('标题')
  })

  it('连续改动会重置计时，不会提前落库', async () => {
    const { api, commits } = mountHost()

    api.schedule()
    await vi.advanceTimersByTimeAsync(5000)
    api.schedule()
    await vi.advanceTimersByTimeAsync(5000)
    expect(commits).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(5000)
    expect(commits).toHaveLength(1)
  })

  it('saveNow 立即写回并回到已保存状态', async () => {
    const { api, commits } = mountHost()

    api.schedule()
    api.saveNow()
    expect(commits).toHaveLength(1)
    expect(api.saveStatus.value).toBe('saving')

    await vi.advanceTimersByTimeAsync(200)
    expect(api.saveStatus.value).toBe('saved')
  })

  it('卸载时补一次保存，最后的编辑不会丢', async () => {
    const { wrapper, commits, api } = mountHost()

    api.schedule()
    await nextTick()
    wrapper.unmount()

    expect(commits).toHaveLength(1)
  })

  it('没有改动时卸载也会补存一次（沿用原行为）', async () => {
    const { wrapper, commits } = mountHost()

    await nextTick()
    wrapper.unmount()

    // 原实现无论有没有改动都会在卸载时存一次，这里锁住这个行为
    expect(commits).toHaveLength(1)
  })
})
