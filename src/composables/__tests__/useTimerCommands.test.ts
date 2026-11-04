import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { runTimerCommand } from '../useTimerCommands'
import type { TimerPhase, TimerStatus } from '../../timer/machine'

function makeTimer(opts: {
  status?: TimerStatus
  phase?: TimerPhase
  running?: boolean
} = {}) {
  const status = ref<TimerStatus>(opts.status ?? 'idle')
  const phase = ref<TimerPhase>(opts.phase ?? 'focus')
  const running = ref(opts.running ?? false)

  const timer = {
    status,
    phase,
    running,
    start: vi.fn<(taskId: string | null, taskTitle?: string) => void>(),
    resume: vi.fn<() => void>(),
    pause: vi.fn<() => void>(),
    skipToBreak: vi.fn<() => void>(),
    skipBreak: vi.fn<() => void>(),
  }
  return timer
}

describe('runTimerCommand', () => {
  it('运行中触发开始/暂停快捷键时调用 pause', () => {
    const timer = makeTimer({ status: 'focus', running: true })
    expect(runTimerCommand('toggle-timer', timer)).toBe(true)
    expect(timer.pause).toHaveBeenCalledTimes(1)
    expect(timer.resume).not.toHaveBeenCalled()
    expect(timer.start).not.toHaveBeenCalled()
  })

  it('专注暂停时调用 resume 而不是重新开始', () => {
    const timer = makeTimer({ status: 'focusPaused', running: false })
    expect(runTimerCommand('toggle-timer', timer)).toBe(true)
    expect(timer.resume).toHaveBeenCalledTimes(1)
    expect(timer.start).not.toHaveBeenCalled()
  })

  it('休息暂停时同样走 resume', () => {
    const timer = makeTimer({ status: 'breakPaused', phase: 'break', running: false })
    expect(runTimerCommand('toggle-timer', timer)).toBe(true)
    expect(timer.resume).toHaveBeenCalledTimes(1)
  })

  it('空闲时用 start(null) 开一轮无任务专注', () => {
    const timer = makeTimer({ status: 'idle' })
    expect(runTimerCommand('toggle-timer', timer)).toBe(true)
    expect(timer.start).toHaveBeenCalledWith(null)
  })

  it('阶段已结束时交给 resume 处理待确认通知', () => {
    const timer = makeTimer({ status: 'completed' })
    expect(runTimerCommand('toggle-timer', timer)).toBe(true)
    expect(timer.resume).toHaveBeenCalledTimes(1)
    expect(timer.start).not.toHaveBeenCalled()
  })

  it('专注阶段 skip 调用 skipToBreak', () => {
    const timer = makeTimer({ status: 'focus', running: true })
    expect(runTimerCommand('skip', timer)).toBe(true)
    expect(timer.skipToBreak).toHaveBeenCalledTimes(1)
    expect(timer.skipBreak).not.toHaveBeenCalled()
  })

  it('休息阶段 skip 调用 skipBreak', () => {
    const timer = makeTimer({ status: 'break', phase: 'break', running: true })
    expect(runTimerCommand('skip', timer)).toBe(true)
    expect(timer.skipBreak).toHaveBeenCalledTimes(1)
    expect(timer.skipToBreak).not.toHaveBeenCalled()
  })

  it('空闲或已完成时 skip 不产生动作', () => {
    for (const status of ['idle', 'completed'] as TimerStatus[]) {
      const timer = makeTimer({ status })
      expect(runTimerCommand('skip', timer)).toBe(false)
      expect(timer.skipToBreak).not.toHaveBeenCalled()
      expect(timer.skipBreak).not.toHaveBeenCalled()
    }
  })

  it('未知命令不产生动作', () => {
    const timer = makeTimer({ status: 'focus', running: true })
    expect(runTimerCommand('unknown', timer)).toBe(false)
    expect(timer.pause).not.toHaveBeenCalled()
  })
})
