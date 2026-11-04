/**
 * 系统入口（托盘菜单、全局快捷键）与计时器的唯一桥。
 * 这些动作都复用 useTimer 的既有方法，不在这里重新实现开始/暂停/跳过。
 */
import type { Ref } from 'vue'
import type { TimerPhase, TimerStatus } from '../timer/machine'

export type TimerCommandAction = 'toggle-timer' | 'skip'

export interface TimerCommandTarget {
  status: Ref<TimerStatus>
  phase: Ref<TimerPhase>
  running: Ref<boolean>
  start(taskId: string | null, taskTitle?: string): void
  resume(): void
  pause(): void
  skipToBreak(): void
  skipBreak(): void
}

/**
 * 执行一个系统入口命令。返回是否被处理，方便调用方做日志或提示。
 * - toggle-timer：运行中暂停；暂停/已完成继续；空闲开始新一轮（无任务）
 * - skip：专注跳到休息，休息跳回空闲
 */
export function runTimerCommand(action: string, timer: TimerCommandTarget): boolean {
  if (action === 'toggle-timer') {
    if (timer.running.value) {
      timer.pause()
      return true
    }
    const status = timer.status.value
    if (status === 'focusPaused' || status === 'breakPaused' || status === 'completed') {
      timer.resume()
      return true
    }
    if (status === 'idle') {
      timer.start(null)
      return true
    }
    return false
  }

  if (action === 'skip') {
    const status = timer.status.value
    if (status === 'idle' || status === 'completed') return false
    if (timer.phase.value === 'focus') {
      timer.skipToBreak()
    } else {
      timer.skipBreak()
    }
    return true
  }

  return false
}
