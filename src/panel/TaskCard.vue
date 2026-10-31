<script setup lang="ts">
import { getCategoryColor } from '../composables/useMemos'
import type { Task } from '../composables/useTasks'

withDefaults(defineProps<{
  task: Task
  groups: Array<{ id: string; name: string; color: string }>
  /** compact 用于已完成列表：不显示计时器、播放键和子任务 */
  variant?: 'full' | 'compact'
  isRunning?: boolean
  isSelected?: boolean
  showBatchCheckbox?: boolean
  selectionMode?: boolean
  phase?: 'focus' | 'break'
  displayTime?: string
  running?: boolean
  expanded?: boolean
  activeSubtaskId?: string | null
}>(), {
  variant: 'full',
  isRunning: false,
  isSelected: false,
  showBatchCheckbox: false,
  selectionMode: false,
  phase: 'focus',
  displayTime: '',
  running: false,
  expanded: false,
  activeSubtaskId: null,
})

const emit = defineEmits<{
  viewDetail: []
  toggleComplete: []
  toggleSelect: []
  start: []
  startSubtask: [subtaskId: string]
  toggleSubtask: [subtaskId: string]
  toggleExpand: []
  pause: []
  resume: []
  abandon: []
  finish: []
  contextmenu: [event: MouseEvent]
}>()

function formatShortDate(dateStr: string | null): string {
  if (!dateStr) return ''
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const diff = Math.floor((date.getTime() - today.getTime()) / 86400000)
  if (diff === 0) return '今天'
  if (diff === 1) return '明天'
  if (diff === -1) return '昨天'
  return `${m}/${d}`
}
</script>

<template>
  <div
    class="task-card"
    :class="{
      'is-running': isRunning,
      'is-completed': task.completed,
      'is-selected': showBatchCheckbox && isSelected,
      'completed-card': variant === 'compact',
    }"
    @contextmenu="emit('contextmenu', $event)"
    @click="showBatchCheckbox && selectionMode ? emit('toggleSelect') : null"
  >
    <!-- Row 1: checkbox + title + actions -->
    <div class="task-row">
      <button
        v-if="showBatchCheckbox"
        class="task-checkbox batch-checkbox"
        :class="{ checked: isSelected }"
        @click.stop="emit('toggleSelect')"
        :title="isSelected ? '取消选择' : '选择'"
      >
        <svg v-if="isSelected" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>
      </button>
      <button
        class="task-checkbox"
        :class="{ checked: task.completed }"
        @click="emit('toggleComplete')"
      >
        <svg v-if="task.completed" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>
      </button>

      <span class="task-title" :class="{ 'line-through': task.completed }" @click="emit('viewDetail')">{{ task.title }}</span>

      <!-- Timer display (if running on this task) -->
      <div v-if="variant === 'full' && isRunning" class="task-timer" @click.stop>
        <span class="timer-phase">{{ phase === 'focus' ? '专注' : '休息' }}</span>
        <span class="timer-time">{{ displayTime }}</span>
        <div class="timer-controls">
          <button class="timer-btn" :class="{ 'is-paused': !running }" @click.stop="running ? emit('pause') : emit('resume')" :title="running ? '暂停' : '继续'">
            <svg v-if="running" width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
            <svg v-else width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z"/></svg>
          </button>
          <button class="timer-btn done-btn" @click.stop="emit('finish')" title="完成">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>
          </button>
          <button class="timer-btn stop-btn" @click.stop="emit('abandon')" title="停止">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>
          </button>
        </div>
      </div>

      <!-- Play button (if not running on this task) -->
      <button
        v-else-if="variant === 'full'"
        class="task-play-btn"
        @click.stop="emit('start')"
        title="开始专注"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z"/></svg>
      </button>

      <!-- Subtask toggle button (next to play button) -->
      <button
        v-if="variant === 'full' && task.subtasks.length > 0"
        class="subtask-toggle-btn"
        :class="{ expanded: expanded }"
        @click.stop="emit('toggleExpand')"
        :title="expanded ? '收起子任务' : '展开子任务'"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
    </div>

    <!-- Row 2: meta badges -->
    <div v-if="task.dueDate || task.pomodoroCount > 0 || task.groupId" class="task-meta-row">
      <span v-if="task.pomodoroCount > 0" class="task-pomodoro">🍅 {{ task.pomodoroCount }}</span>
      <span v-if="task.dueDate" class="task-date">
        {{ formatShortDate(task.dueDate) }}
      </span>
      <span v-if="task.groupId" class="task-group-badge">
        <span class="group-dot-sm" :style="{ backgroundColor: getCategoryColor(groups.find(g => g.id === task.groupId)?.color ?? 'yellow').icon }"></span>
        {{ groups.find(g => g.id === task.groupId)?.name ?? '' }}
      </span>
    </div>

    <!-- Subtasks (expanded) -->
    <div v-if="variant === 'full' && task.subtasks.length > 0 && expanded" class="subtask-list">
      <div
        v-for="sub in task.subtasks"
        :key="sub.id"
        class="subtask-row"
        :class="{ 'is-active-sub': activeSubtaskId === sub.id, completed: sub.completed }"
      >
        <button
          class="subtask-checkbox"
          :class="{ checked: sub.completed }"
          @click.stop="emit('toggleSubtask', sub.id)"
        >
          <svg v-if="sub.completed" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>
        </button>
        <span class="subtask-title" :class="{ 'line-through': sub.completed }">{{ sub.title }}</span>
        <button
          class="subtask-play-btn"
          :class="{ active: activeSubtaskId === sub.id }"
          @click.stop="emit('startSubtask', sub.id)"
          title="开始子任务"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z"/></svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "../styles.css";

/* Task card */
.task-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.06);
  transition: all 0.2s;
  overflow: hidden;
  flex-shrink: 0;
}

.task-card:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.12);
}

.task-card.is-running {
  background: color-mix(in srgb, var(--focus-color) 10%, rgba(28, 28, 32, 0.95));
  border-color: color-mix(in srgb, var(--focus-color) 30%, transparent);
  border-left: 3px solid var(--focus-color);
  padding: 8px 10px;
}

.task-card.completed-card {
  opacity: 0.55;
}

.task-card.completed-card:hover {
  opacity: 0.75;
}

.task-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
}

.task-checkbox {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: transparent;
  border: 2px solid rgba(255, 255, 255, 0.28);
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  flex-shrink: 0;
  padding: 0;
}

.task-checkbox:hover {
  border-color: var(--break-color);
  background: color-mix(in srgb, var(--break-color) 20%, transparent);
}

.task-checkbox.checked {
  border-color: color-mix(in srgb, var(--focus-color) 70%, transparent);
  background: color-mix(in srgb, var(--focus-color) 25%, transparent);
  color: var(--focus-color);
}

.task-title {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.9);
  line-height: 1.4;
  min-width: 0;
  cursor: pointer;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.task-title.line-through {
  text-decoration: line-through;
  color: rgba(255, 255, 255, 0.35);
}

.task-meta-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-left: 22px;
  padding-top: 2px;
  padding-bottom: 2px;
}

.task-date {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.05);
  padding: 1px 6px;
  border-radius: 4px;
}

.task-pomodoro {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
}

.task-pomodoro.completed-pomodoro {
  color: rgba(255, 255, 255, 0.3);
}

.task-group-badge {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.04);
  padding: 1px 6px 1px 4px;
  border-radius: 4px;
}

.task-play-btn {
  min-width: 20px;
  height: 20px;
  padding: 1px 4px;
  border-radius: 5px;
  font-size: 10px;
  font-weight: 600;
  background: color-mix(in srgb, var(--focus-color) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--focus-color) 30%, transparent);
  color: var(--focus-color);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  flex-shrink: 0;
}

.task-play-btn:hover {
  background: color-mix(in srgb, var(--focus-color) 25%, transparent);
  border-color: color-mix(in srgb, var(--focus-color) 50%, transparent);
}
/* Timer display */
.task-timer {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--focus-color) 10%, rgba(28, 28, 32, 0.8));
  border: 1px solid color-mix(in srgb, var(--focus-color) 25%, transparent);
  flex-shrink: 0;
}

.timer-phase {
  font-size: 10px;
  font-weight: 600;
  color: var(--focus-color);
  letter-spacing: 0.05em;
}

.timer-time {
  font-size: 14px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #fff;
  min-width: 42px;
  text-align: center;
}

.timer-controls {
  display: flex;
  gap: 3px;
}

.timer-btn {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  padding: 0;
}

.timer-btn:hover {
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
}

.timer-btn.is-paused {
  background: color-mix(in srgb, var(--focus-color) 20%, transparent);
  border-color: color-mix(in srgb, var(--focus-color) 40%, transparent);
  color: var(--focus-color);
}

.done-btn {
  color: #3a9e6e;
}

.done-btn:hover {
  background: rgba(58, 158, 110, 0.15);
  border-color: rgba(58, 158, 110, 0.3);
  color: #4ade80;
}

.stop-btn {
  color: rgba(255, 255, 255, 0.4);
}

.stop-btn:hover {
  background: rgba(248, 113, 113, 0.15);
  border-color: rgba(248, 113, 113, 0.3);
  color: #f87171;
}
/* Subtask toggle button (next to play button) */
.subtask-toggle-btn {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.2s;
  padding: 0;
  margin-left: 4px;
}

.subtask-toggle-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.8);
}

.subtask-toggle-btn svg {
  transition: transform 0.2s;
}

.subtask-toggle-btn.expanded {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.7);
}

.subtask-toggle-btn.expanded svg {
  transform: rotate(180deg);
}
/* Subtasks */
.subtask-list {
  margin-top: 4px;
  margin-left: 22px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.subtask-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 6px;
  border-radius: 6px;
  min-height: 28px;
  transition: background 0.15s;
}

.subtask-row:hover {
  background: rgba(255, 255, 255, 0.03);
}

.subtask-row.is-active-sub {
  background: color-mix(in srgb, var(--focus-color) 8%, transparent);
}

.subtask-row.completed {
  opacity: 0.5;
}

.subtask-checkbox {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: transparent;
  border: 2px solid rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  flex-shrink: 0;
  padding: 0;
}

.subtask-checkbox:hover {
  border-color: color-mix(in srgb, var(--focus-color) 50%, transparent);
}

.subtask-checkbox.checked {
  border-color: color-mix(in srgb, var(--focus-color) 60%, transparent);
  background: color-mix(in srgb, var(--focus-color) 20%, transparent);
  color: var(--focus-color);
}

.subtask-title {
  flex: 1;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subtask-title.line-through {
  text-decoration: line-through;
  color: rgba(255, 255, 255, 0.3);
}

.subtask-play-btn {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.35);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  flex-shrink: 0;
  padding: 0;
  opacity: 0;
}

.subtask-row:hover .subtask-play-btn {
  opacity: 1;
}

.subtask-play-btn:hover {
  background: color-mix(in srgb, var(--focus-color) 15%, transparent);
  border-color: color-mix(in srgb, var(--focus-color) 30%, transparent);
  color: var(--focus-color);
}

.subtask-play-btn.active {
  opacity: 1;
  background: color-mix(in srgb, var(--focus-color) 20%, transparent);
  border-color: color-mix(in srgb, var(--focus-color) 40%, transparent);
  color: var(--focus-color);
}
/* Selected card highlight */
.task-card.is-selected {
  background: color-mix(in srgb, var(--focus-color) 8%, rgba(255, 255, 255, 0.05));
  border-color: color-mix(in srgb, var(--focus-color) 35%, transparent);
}
/* Batch-select checkbox beside each completed task */
.batch-checkbox {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  border-width: 1.5px;
  margin-right: -2px;
}

.batch-checkbox.checked {
  border-color: color-mix(in srgb, var(--focus-color) 70%, transparent);
  background: color-mix(in srgb, var(--focus-color) 25%, transparent);
  color: var(--focus-color);
}
</style>
