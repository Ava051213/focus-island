import { ref, computed, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useSettings } from './useSettings'
import { useIslandState } from './useIslandState'
import { useTimer } from './useTimer'

// Collapsed strip window height (logical px). The visible bar is thinner inside.
export const DOCK_STRIP_WINDOW_H = 14

const dockExpanded = ref(false)
const panelVisible = ref(false)
let collapseTimer: ReturnType<typeof setTimeout> | null = null
let watchInstalled = false
let panelListenerInstalled = false

export function useDockMode() {
  const { settings } = useSettings()
  const { state, notificationVisible } = useIslandState()
  const timer = useTimer()

  const dockMode = computed(() => settings.value.islandDisplayMode === 'dock')

  // During notifications / idle-alert / panel-open, always show the full capsule.
  const forceExpanded = computed(
    () => notificationVisible.value || state.value === 'alert' || panelVisible.value
  )

  const dockCollapsed = computed(
    () => dockMode.value && !dockExpanded.value && !forceExpanded.value
  )

  const stripProgress = computed(() => {
    if (state.value !== 'focus' && state.value !== 'break') return 0
    const v = timer.progress.value
    if (!Number.isFinite(v) || v <= 0) return 0
    return v >= 1 ? 1 : v
  })

  const stripColor = computed(() => {
    if (state.value === 'focus') return 'var(--focus-color)'
    if (state.value === 'break') return 'var(--break-color)'
    return 'var(--idle-color)'
  })

  // 指针轮询由主窗口统一驱动（与悬停检测共用一次 invoke），这里只消费结果。
  function updatePointerOver(over: boolean) {
    if (!dockMode.value || forceExpanded.value) {
      if (dockExpanded.value && !forceExpanded.value) dockExpanded.value = false
      return
    }
    if (over) {
      if (collapseTimer !== null) {
        clearTimeout(collapseTimer)
        collapseTimer = null
      }
      if (!dockExpanded.value) dockExpanded.value = true
    } else if (dockExpanded.value && collapseTimer === null) {
      collapseTimer = setTimeout(() => {
        dockExpanded.value = false
        collapseTimer = null
      }, 350)
    }
  }

  function resetDock() {
    if (collapseTimer !== null) {
      clearTimeout(collapseTimer)
      collapseTimer = null
    }
    dockExpanded.value = false
  }

  // 关闭停靠模式时立即收起细条。
  if (!watchInstalled) {
    watchInstalled = true
    watch(
      dockMode,
      (on) => {
        if (!on) resetDock()
      },
      { immediate: true }
    )
  }

  // Track panel visibility: dock mode only applies when panel is closed.
  if (!panelListenerInstalled) {
    panelListenerInstalled = true
    invoke<boolean>('is_panel_visible').then((v) => { panelVisible.value = v }).catch(() => {})
    listen<string>('island-panel-motion', ({ payload }) => {
      if (payload === 'open') panelVisible.value = true
      else if (payload === 'close') panelVisible.value = false
    }).catch(() => {})
  }

  return {
    dockMode,
    dockExpanded,
    dockCollapsed,
    forceExpanded,
    updatePointerOver,
    stripProgress,
    stripColor,
    DOCK_STRIP_WINDOW_H,
  }
}
