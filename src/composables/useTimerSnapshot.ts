import { ref } from 'vue'
import { createPersistedStore } from './persistence'
import { parseSnapshot, type TimerSnapshot } from '../timer/snapshot'

/** 只在 panel 窗口读写，用来在崩溃/重启后恢复进行中的一轮 */
const snapshot = ref<TimerSnapshot | null>(null)

const store = createPersistedStore({
  file: 'timer-snapshot.json',
  schemaVersion: 1,
  // 快照要尽快落盘，不能等 300ms 防抖
  debounceMs: 0,
  snapshot: () => snapshot.value,
  restore: (data) => {
    if (data === null) {
      snapshot.value = null
      return
    }
    const parsed = parseSnapshot(data)
    if (!parsed) throw new Error('timer-snapshot.json is invalid')
    snapshot.value = parsed
  },
})

export function useTimerSnapshot() {
  void store.ensureLoaded()

  function save(next: TimerSnapshot | null) {
    snapshot.value = next
  }

  function clear() {
    snapshot.value = null
  }

  return {
    snapshot,
    save,
    clear,
    loaded: store.loaded,
    ensureLoaded: store.ensureLoaded,
  }
}
