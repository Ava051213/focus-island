import { onBeforeUnmount, ref } from 'vue'
import type { Memo } from './useMemos'

export type MemoPatch = Partial<Pick<Memo, 'title' | 'content' | 'categoryId' | 'isPinned' | 'estimatedPomodoros'>>

/** 停手 10 秒才真正落库，减少编辑时的列表抖动 */
const SAVE_DEBOUNCE_MS = 10000
/** 先等 2 秒再显示「未保存」，避免刚敲一个字就闪提示 */
const UNSAVED_HINT_MS = 2000
/** 「保存中」保持这么久再切回「已保存」，纯视觉过渡 */
const SAVING_HINT_MS = 200

export type SaveStatus = 'saved' | 'saving' | 'unsaved'

/**
 * 编辑器的自动保存：改动只调度，真正写回由定时器触发。
 * 组件卸载时会先取消防抖再补一次保存，避免最后一段编辑丢掉。
 */
export function useMemoAutoSave(options: {
  /** 取当前编辑器里的全部字段 */
  collect: () => MemoPatch
  /** 真正把 patch 交出去（通常是 emit('update')） */
  commit: (patch: MemoPatch) => void
}) {
  const saveStatus = ref<SaveStatus>('saved')
  let timer: number | null = null

  function cancel() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function saveNow() {
    cancel()
    saveStatus.value = 'saving'
    options.commit(options.collect())
    timer = window.setTimeout(() => {
      saveStatus.value = 'saved'
      timer = null
    }, SAVING_HINT_MS)
  }

  function schedule() {
    cancel()
    if (saveStatus.value === 'saved') {
      timer = window.setTimeout(() => {
        saveStatus.value = 'unsaved'
        timer = window.setTimeout(saveNow, SAVE_DEBOUNCE_MS - UNSAVED_HINT_MS)
      }, UNSAVED_HINT_MS)
    } else {
      timer = window.setTimeout(saveNow, SAVE_DEBOUNCE_MS)
    }
  }

  onBeforeUnmount(() => {
    cancel()
    // 离开前最后存一次，别让这段编辑白写
    saveNow()
  })

  return { saveStatus, schedule, saveNow, cancel }
}
