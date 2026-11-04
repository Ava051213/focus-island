/**
 * 全局快捷键（panel 窗口专用）
 *
 * 注册在 Rust 侧完成（`update_shortcuts` 命令），这里只负责：
 * - 监听 settings 变化并即时重新注册；
 * - 把 Rust 抛出的冲突/解析错误显示到设置页；
 * - 接收 `shortcut-command`，复用 useTimer 的既有动作。
 */
import { ref, watch } from 'vue'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useSettings } from './useSettings'
import { useTimer } from './useTimer'
import { runTimerCommand, type TimerCommandTarget } from './useTimerCommands'
import { validateShortcutConfig, type ShortcutConfig } from '../utils/shortcuts'

interface ShortcutUpdateResult {
  ok: boolean
  errors: Array<{ action: string; message: string }>
}

/** 最近一次注册失败的原因，设置页直接展示 */
export const shortcutError = ref<string | null>(null)

let listenerStarted = false

function startCommandListener(timer: TimerCommandTarget) {
  if (listenerStarted) return
  listenerStarted = true
  listen<string>('shortcut-command', ({ payload }) => {
    const action = String(payload ?? '')
    if (action === 'show-window') {
      // 打开/收起专注清单，和托盘「打开专注清单」行为一致
      invoke('toggle_panel').catch(() => {})
      return
    }
    runTimerCommand(action, timer)
  }).catch(() => {})
}

export function useShortcut(injected?: TimerCommandTarget) {
  const { settings, settingsReady } = useSettings()
  const timer = injected ?? useTimer()

  async function applyShortcut() {
    const config: ShortcutConfig = {
      toggleTimer: settings.value.shortcuts.toggleTimer,
      showWindow: settings.value.shortcuts.showWindow,
      enabled: settings.value.shortcuts.enabled,
    }

    const localError = validateShortcutConfig(config)
    if (!isTauri()) {
      shortcutError.value = localError
      return
    }

    if (localError) {
      // 配置本身不合法：顺带注销旧组合，避免系统里残留一个不再使用的快捷键
      shortcutError.value = localError
      await invoke('update_shortcuts', {
        config: { enabled: false, toggleTimer: '', showWindow: '' },
      }).catch(() => {})
      return
    }

    try {
      const result = await invoke<ShortcutUpdateResult>('update_shortcuts', { config })
      shortcutError.value = result.ok
        ? null
        : result.errors.map(item => item.message).join('；')
    } catch (error) {
      // 注册失败不影响应用使用，只是没有全局快捷键
      shortcutError.value = '快捷键注册失败，计时仍可正常使用'
      console.error('[shortcut] update failed', error)
    }
  }

  // 等 settings.json 读完再注册，避免先用默认值抢注一个用户并不想要的组合
  watch(
    [() => settings.value.shortcuts, settingsReady],
    ([, ready]) => {
      if (ready) void applyShortcut()
    },
    { deep: true, immediate: true },
  )

  startCommandListener(timer)

  return { shortcutError, applyShortcut }
}
