import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTaskTimeCategory, useTasks, type Task } from '../useTasks'

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

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: `t-${Math.random().toString(36).slice(2)}`,
    title: '任务',
    note: '',
    groupId: null,
    dueDate: null,
    completed: false,
    pomodoroCount: 0,
    priority: 0,
    subtasks: [],
    createdAt: 0,
    updatedAt: 0,
    lastActiveAt: 0,
    ...over,
  }
}

describe('getTaskTimeCategory', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // 固定「今天」为 2026-10-30，避免用例随真实日期漂移
    vi.setSystemTime(new Date(2026, 9, 30, 10, 0, 0))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('无到期日归入 nodate', () => {
    expect(getTaskTimeCategory(makeTask({ dueDate: null }))).toBe('nodate')
  })

  it('当天归入 today', () => {
    expect(getTaskTimeCategory(makeTask({ dueDate: '2026-10-30' }))).toBe('today')
  })

  it('昨天及更早归入 overdue', () => {
    expect(getTaskTimeCategory(makeTask({ dueDate: '2026-10-29' }))).toBe('overdue')
    expect(getTaskTimeCategory(makeTask({ dueDate: '2025-01-01' }))).toBe('overdue')
  })

  it('明天归入 tomorrow', () => {
    expect(getTaskTimeCategory(makeTask({ dueDate: '2026-10-31' }))).toBe('tomorrow')
  })

  it('第 2~6 天归入 week，第 7 天起归入 later', () => {
    expect(getTaskTimeCategory(makeTask({ dueDate: '2026-11-01' }))).toBe('week')
    expect(getTaskTimeCategory(makeTask({ dueDate: '2026-11-05' }))).toBe('week')
    expect(getTaskTimeCategory(makeTask({ dueDate: '2026-11-06' }))).toBe('later')
  })

  it('跨月边界按自然日算，不受月份长度影响', () => {
    vi.setSystemTime(new Date(2026, 9, 31, 23, 30, 0))
    expect(getTaskTimeCategory(makeTask({ dueDate: '2026-11-01' }))).toBe('tomorrow')
  })

  it('跨年边界同样按自然日算', () => {
    vi.setSystemTime(new Date(2026, 11, 31, 8, 0, 0))
    expect(getTaskTimeCategory(makeTask({ dueDate: '2027-01-01' }))).toBe('tomorrow')
    expect(getTaskTimeCategory(makeTask({ dueDate: '2026-12-31' }))).toBe('today')
  })
})

describe('useTasks 分桶', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 30, 10, 0, 0))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('逾期任务同时进入 overdue 与 today 两个桶', () => {
    const { tasks, addTask, overdueTasks, todayTasks } = useTasks()
    tasks.value = []
    addTask('逾期任务', '2026-10-28')
    addTask('今天的任务', '2026-10-30')

    expect(overdueTasks.value.map(t => t.title)).toEqual(['逾期任务'])
    // today 桶是「今天要处理的所有事」，逾期任务也要留在里面
    expect(todayTasks.value.map(t => t.title).sort()).toEqual(['今天的任务', '逾期任务'])
  })

  it('已完成的任务不进入 active 与任何时间桶', () => {
    const { tasks, addTask, updateTask, activeTasks, todayTasks } = useTasks()
    tasks.value = []
    const task = addTask('要完成的任务', '2026-10-30')
    updateTask(task.id, { completed: true })

    expect(activeTasks.value).toHaveLength(0)
    expect(todayTasks.value).toHaveLength(0)
  })

  it('toggleComplete 完成时清空优先级，取消完成时落到 1', () => {
    const { tasks, addTask, toggleComplete, setTaskPriority } = useTasks()
    tasks.value = []
    const task = addTask('优先级任务', '2026-10-30')
    setTaskPriority(task.id, 2)

    toggleComplete(task.id)
    expect(tasks.value[0].completed).toBe(true)
    expect(tasks.value[0].priority).toBe(0)

    toggleComplete(task.id)
    expect(tasks.value[0].completed).toBe(false)
    expect(tasks.value[0].priority).toBe(1)
  })

  it('recentFocus 最多保留 3 条并按最近活跃倒序', () => {
    const { tasks, addTask, touchTask, recentFocusTasks } = useTasks()
    tasks.value = []
    const created = [0, 1, 2, 3].map(i => addTask(`任务 ${i}`, '2026-10-30'))

    created.forEach((task, i) => {
      touchTask(task.id)
      vi.setSystemTime(new Date(2026, 9, 30, 10, 0, i + 1))
    })

    expect(recentFocusTasks.value).toHaveLength(3)
    expect(recentFocusTasks.value.map(t => t.title)).toEqual(['任务 3', '任务 2', '任务 1'])
  })
})
