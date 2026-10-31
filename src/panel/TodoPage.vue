<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, onActivated, onDeactivated } from 'vue'
import { useTasks, getTaskTimeCategory, type Task } from '../composables/useTasks'
import { useTaskGroups } from '../composables/useTaskGroups'
import { useTimerBridge } from '../composables/useTimerBridge'
import TaskGroupDialog from './TaskGroupDialog.vue'
import BatchToolbar from './BatchToolbar.vue'
import TaskContextMenu from './TaskContextMenu.vue'
import TaskTabs from './TaskTabs.vue'
import QuickAddBar from './QuickAddBar.vue'
import TaskCard from './TaskCard.vue'

const props = defineProps<{ initialTab?: string; searchQuery?: string }>()
const emit = defineEmits<{
  viewDetail: [taskId: string],
  tabChange: [tab: string],
  activeTabLabel: [label: string]
}>()

const {
  tasks,
  addTask,
  toggleComplete,
  deleteTask,
  updateTask,
  incrementPomodoro,
  touchTask,
  toggleSubtask,
  todayTasks,
  tomorrowTasks,
  weekTasks,
  laterTasks,
  completedTasks,
  groupTasks,
} = useTasks()
const { groups } = useTaskGroups()
const {
  start,
  pause,
  resume,
  running,
  activeTaskId,
  displayTime,
  phase,
  abandon,
  setSubtaskContext,
  activeSubtaskId,
} = useTimerBridge()

// --- Tab state ---
type TabKey = string
const activeTab = ref<TabKey>(props.initialTab ?? 'today')

// Watch for external tab changes (e.g. navigation from home page)
watch(() => props.initialTab, (tab) => {
  if (tab) {
    activeTab.value = tab
  }
})

const showGroupDialog = ref(false)

// --- Quick-add state ---

// --- Completed section ---
const showCompleted = ref(false)

// --- Batch operations (completed tab) ---
const selectedIds = ref<Set<string>>(new Set())
const selectionMode = ref(false)

const allCompletedIds = computed(() => displayTasks.value.map(t => t.id))
const allSelected = computed(() => allCompletedIds.value.length > 0 && allCompletedIds.value.every(id => selectedIds.value.has(id)))
const someSelected = computed(() => selectedIds.value.size > 0)
const olderThan7dCount = computed(() => {
  const cutoff = Date.now() - 7 * 86400000
  return completedTasks.value.filter(t => t.updatedAt < cutoff).length
})

function toggleOneSelected(id: string) {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
  if (next.size === 0) selectionMode.value = false
}

function toggleSelectAll() {
  if (allSelected.value) {
    selectedIds.value = new Set()
    selectionMode.value = false
  } else {
    selectedIds.value = new Set(allCompletedIds.value)
    selectionMode.value = true
  }
}

function deleteSelected() {
  if (selectedIds.value.size === 0) return
  const ids = [...selectedIds.value]
  for (const id of ids) deleteTask(id)
  selectedIds.value = new Set()
  selectionMode.value = false
}

function restoreSelected() {
  if (selectedIds.value.size === 0) return
  const ids = [...selectedIds.value]
  for (const id of ids) toggleComplete(id)
  selectedIds.value = new Set()
  selectionMode.value = false
}

function deleteOlderThan7d() {
  const cutoff = Date.now() - 7 * 86400000
  const ids = completedTasks.value.filter(t => t.updatedAt < cutoff).map(t => t.id)
  if (ids.length === 0) return
  for (const id of ids) deleteTask(id)
  selectedIds.value = new Set()
  selectionMode.value = false
}

function deleteAllCompleted() {
  const ids = completedTasks.value.map(t => t.id)
  if (ids.length === 0) return
  for (const id of ids) deleteTask(id)
  selectedIds.value = new Set()
  selectionMode.value = false
}

// Clear selection when leaving the completed tab
watch(activeTab, (tab) => {
  if (tab !== 'completed') {
    selectedIds.value = new Set()
    selectionMode.value = false
  }
})

// --- Subtask expand state ---
const expandedSubtasks = ref<Set<string>>(new Set())

function toggleSubtaskExpand(taskId: string) {
  if (expandedSubtasks.value.has(taskId)) {
    expandedSubtasks.value.delete(taskId)
  } else {
    expandedSubtasks.value.add(taskId)
  }
}

// --- Show more pagination ---
const PAGE_SIZE = 10
const visibleCount = ref(PAGE_SIZE)

const displayVisibleTasks = computed<Task[]>(() => {
  const all = displayTasks.value
  return all.slice(0, visibleCount.value)
})

const hasMoreTasks = computed(() => displayTasks.value.length > visibleCount.value)

function loadMore() {
  visibleCount.value += PAGE_SIZE
}

// reset pagination on tab change & sync tab selection back to parent & update default group for new tasks
watch(activeTab, (newTab) => {
  visibleCount.value = PAGE_SIZE
  emit('tabChange', newTab)
  
}, { immediate: true })

// Reset pagination when search query changes
watch(() => props.searchQuery, () => {
  visibleCount.value = PAGE_SIZE
})

// --- Context menu ---
const contextMenu = ref<{ taskId: string; x: number; y: number; completed: boolean } | null>(null)

// --- Helpers ---
function handleAddTask(payload: { title: string; dueDate: string | null; groupId: string | null }) {
  addTask(payload.title, payload.dueDate, payload.groupId)
}

function handleStartTask(task: Task) {
  setSubtaskContext(null, null)
  if (activeTaskId.value === task.id) {
    if (running.value) pause()
    else resume()
  } else {
    touchTask(task.id)
    start(task.id, task.title)
  }
}

function handleStartSubtask(task: Task, subtaskId: string) {
  const sub = task.subtasks.find(s => s.id === subtaskId)
  if (sub) {
    touchTask(task.id)
    setSubtaskContext(sub.id, sub.title)
    start(task.id, `${task.title} — ${sub.title}`)
  }
}

function handleToggleComplete(taskId: string) {
  if (activeTaskId.value === taskId) {
    abandon()
  }
  toggleComplete(taskId)
}

function handleDoneTimer() {
  if (!activeTaskId.value) return
  incrementPomodoro(activeTaskId.value)
  abandon()
}

// --- Search ---
function taskMatchesQuery(task: Task, query: string): boolean {
  if (!query) return true
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (task.title.toLowerCase().includes(q)) return true
  if (task.note && task.note.toLowerCase().includes(q)) return true
  if (task.subtasks && task.subtasks.some(s => s.title.toLowerCase().includes(q))) return true
  return false
}

// --- Tabs ---
const allTabs = computed<{ key: string; label: string; count: number }[]>(() => {
  const tabs: { key: string; label: string; count: number }[] = [
    { key: 'today', label: '今天', count: todayTasks.value.length },
    { key: 'tomorrow', label: '明天', count: tomorrowTasks.value.length },
    { key: 'week', label: '本周', count: weekTasks.value.length },
    { key: 'later', label: '稍后', count: laterTasks.value.length },
    { key: 'completed', label: '已完成', count: completedTasks.value.length },
  ]
  for (const group of groups.value) {
    const groupTaskList = groupTasks(group.id)
    tabs.push({ key: group.id, label: group.name, count: groupTaskList.length })
  }
  return tabs
})

const activeTabLabel = computed(() => {
  const tab = allTabs.value.find(t => t.key === activeTab.value)
  return tab?.label ?? ''
})

watch(activeTabLabel, (label) => {
  emit('activeTabLabel', label)
}, { immediate: true })

// --- Display tasks ---
const displayTasks = computed<Task[]>(() => {
  const tab = activeTab.value
  const q = props.searchQuery ?? ''
  let list: Task[]
  if (tab === 'today') {
    list = [...todayTasks.value].sort((a, b) => {
      const catA = getTaskTimeCategory(a)
      const catB = getTaskTimeCategory(b)
      if (catA === catB) return 0
      if (catA === 'today') return -1
      return 1
    })
  } else if (tab === 'tomorrow') {
    list = tomorrowTasks.value
  } else if (tab === 'week') {
    list = weekTasks.value
  } else if (tab === 'later') {
    list = laterTasks.value
  } else if (tab === 'completed') {
    list = completedTasks.value
  } else {
    list = groupTasks(tab)
  }
  if (!q.trim()) return list
  return list.filter(t => taskMatchesQuery(t, q))
})

const displayCompleted = computed<Task[]>(() => {
  const tab = activeTab.value
  const q = (props.searchQuery ?? '').trim()
  if (tab === 'completed' || tab === 'today') return []
  let currentCompleted: Task[]
  if (tab === 'tomorrow') {
    currentCompleted = tasks.value.filter(t => t.completed && getTaskTimeCategory(t) === 'tomorrow')
  } else if (tab === 'week') {
    currentCompleted = tasks.value.filter(t => t.completed && getTaskTimeCategory(t) === 'week')
  } else if (tab === 'later') {
    currentCompleted = tasks.value.filter(t => t.completed && getTaskTimeCategory(t) === 'later')
  } else {
    currentCompleted = tasks.value.filter(t => t.completed && t.groupId === tab)
  }
  if (!q) return currentCompleted
  return currentCompleted.filter(t => taskMatchesQuery(t, q))
})

// --- Context menu ---
function onContextMenu(e: MouseEvent, task: Task) {
  e.preventDefault()
  if (contextMenu.value && contextMenu.value.taskId === task.id) {
    closeContextMenu()
  } else {
    // 贴边时的位置修正交给 TaskContextMenu 自己测量，这里只记原始坐标
    contextMenu.value = { taskId: task.id, x: e.clientX, y: e.clientY, completed: task.completed }
  }
}

function closeContextMenu() {
  contextMenu.value = null
}

function contextSetDate(dateStr: string) {
  if (!contextMenu.value) return
  updateTask(contextMenu.value.taskId, { dueDate: dateStr })
  closeContextMenu()
}

function contextDelete() {
  if (!contextMenu.value) return
  deleteTask(contextMenu.value.taskId)
  closeContextMenu()
}

function contextRestore() {
  if (!contextMenu.value) return
  toggleComplete(contextMenu.value.taskId)
  closeContextMenu()
}

function contextMoveToGroup(groupId: string | null) {
  if (!contextMenu.value) return
  updateTask(contextMenu.value.taskId, { groupId })
  closeContextMenu()
}

// --- Click outside ---
function onClickOutside() {
  closeContextMenu()
}

function onWindowClick(e: MouseEvent) {
  if (contextMenu.value) {
    const target = e.target as HTMLElement
    if (!target.closest('.context-menu')) {
      closeContextMenu()
    }
  }
}

function onWindowContextMenu(e: MouseEvent) {
  if (contextMenu.value) {
    const target = e.target as HTMLElement
    if (!target.closest('.context-menu') && !target.closest('.task-card')) {
      closeContextMenu()
    }
  }
}

// Keyboard handler for Escape
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (selectionMode.value) {
      selectionMode.value = false
      selectedIds.value = new Set()
    } else if (showGroupDialog.value) {
      showGroupDialog.value = false
    } else if (contextMenu.value) {
      closeContextMenu()
    }
  }
}

let windowListenersBound = false

function bindWindowListeners() {
  if (windowListenersBound) return
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('click', onClickOutside)
  window.addEventListener('click', onWindowClick, true)
  window.addEventListener('contextmenu', onWindowContextMenu, true)
  windowListenersBound = true
}

function unbindWindowListeners() {
  if (!windowListenersBound) return
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('click', onClickOutside)
  window.removeEventListener('click', onWindowClick, true)
  window.removeEventListener('contextmenu', onWindowContextMenu, true)
  windowListenersBound = false
}

onMounted(() => {
  bindWindowListeners()
})

onActivated(() => {
  bindWindowListeners()
})

onDeactivated(() => {
  unbindWindowListeners()
  closeContextMenu()
})

onBeforeUnmount(() => {
  unbindWindowListeners()
})
</script>

<template>
  <div class="todo-page" @click="onClickOutside">
    <!-- Tab bar as header -->
    <TaskTabs
      :tabs="allTabs"
      :active-tab="activeTab"
      :groups="groups"
      @select="activeTab = $event"
      @toggleGroupDialog="showGroupDialog = !showGroupDialog"
    />

    <!-- Quick-add row (hidden on completed tab) -->
    <QuickAddBar
      v-if="activeTab !== 'completed'"
      :groups="groups"
      :active-tab="activeTab"
      @submit="handleAddTask"
    />

    <!-- Completed tab: batch toolbar -->
    <BatchToolbar
      v-if="activeTab === 'completed' && displayTasks.length > 0"
      :all-selected="allSelected"
      :some-selected="someSelected"
      :selected-count="selectedIds.size"
      :selection-mode="selectionMode"
      :older-than-7d-count="olderThan7dCount"
      :total-count="displayTasks.length"
      @toggleAll="toggleSelectAll"
      @toggleMode="selectionMode = !selectionMode"
      @restoreSelected="restoreSelected"
      @deleteSelected="deleteSelected"
      @deleteOlderThan7d="deleteOlderThan7d"
      @deleteAllCompleted="deleteAllCompleted"
    />

    <!-- Task list -->
    <div class="task-list">
      <div v-if="displayTasks.length === 0 && displayCompleted.length === 0" class="empty-state">
        <svg v-if="searchQuery" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="7"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <svg v-else width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1.5">
          <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
        </svg>
        <span>{{ searchQuery ? '没有匹配的任务' : '暂无任务' }}</span>
      </div>

      <template v-for="(task, index) in displayVisibleTasks" :key="task.id">
        <div
          v-if="activeTab === 'today' && getTaskTimeCategory(task) === 'overdue' && (index === 0 || getTaskTimeCategory(displayVisibleTasks[index-1]) === 'today')"
          class="overdue-divider"
        >
          <span class="divider-label">已过期</span>
        </div>
        <TaskCard
          :task="task"
          :groups="groups"
          :is-running="activeTaskId === task.id"
          :is-selected="selectedIds.has(task.id)"
          :show-batch-checkbox="activeTab === 'completed'"
          :selection-mode="selectionMode"
          :phase="phase"
          :display-time="displayTime"
          :running="running"
          :expanded="expandedSubtasks.has(task.id)"
          :active-subtask-id="activeSubtaskId"
          @viewDetail="emit('viewDetail', task.id)"
          @toggleComplete="handleToggleComplete(task.id)"
          @toggleSelect="toggleOneSelected(task.id)"
          @start="handleStartTask(task)"
          @startSubtask="id => handleStartSubtask(task, id)"
          @toggleSubtask="id => toggleSubtask(task.id, id)"
          @toggleExpand="toggleSubtaskExpand(task.id)"
          @pause="pause"
          @resume="resume"
          @abandon="abandon"
          @finish="handleDoneTimer"
          @contextmenu="onContextMenu($event, task)"
        />
      </template>

      <!-- Load more -->
      <button v-if="hasMoreTasks" class="load-more-btn" @click="loadMore">
        加载更多 ({{ displayTasks.length - visibleCount }} 条)
      </button>

      <!-- Completed section -->
      <div v-if="displayCompleted.length > 0" class="completed-section">
        <button class="completed-header" @click.stop="showCompleted = !showCompleted">
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            :style="{ transform: showCompleted ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }"
          >
            <path d="M9 18l6-6-6-6"/>
          </svg>
          <span>已完成 ({{ displayCompleted.length }})</span>
        </button>
        <transition name="collapse">
          <div v-if="showCompleted" class="completed-list">
            <TaskCard
              v-for="task in displayCompleted"
              :key="task.id"
              :task="task"
              :groups="groups"
              variant="compact"
              @viewDetail="emit('viewDetail', task.id)"
              @toggleComplete="toggleComplete(task.id)"
            />
          </div>
        </transition>
      </div>
    </div>

    <!-- Context menu -->
    <TaskContextMenu
      v-if="contextMenu"
      :menu="contextMenu"
      :groups="groups"
      @setDate="contextSetDate"
      @moveToGroup="contextMoveToGroup"
      @restore="contextRestore"
      @delete="contextDelete"
    />

    <!-- TaskGroupDialog overlay -->
    <TaskGroupDialog v-if="showGroupDialog" @close="showGroupDialog = false" />
  </div>
</template>

<style scoped>
@reference "../styles.css";

.todo-page {
  display: flex;
  flex-direction: column;
  flex: 1;
  height: 100%;
  min-height: 0;
  width: 100%;
  overflow: hidden;
  background: transparent;
  color: rgba(255, 255, 255, 0.9);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

.overdue-divider {
  display: flex;
  align-items: center;
  padding: 10px 14px 6px;
  gap: 12px;
}

.overdue-divider::before,
.overdue-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: linear-gradient(
    to var(--dir, right),
    color-mix(in srgb, var(--focus-color) 35%, transparent),
    transparent
  );
}

.overdue-divider::before {
  --dir: left;
}

.overdue-divider::after {
  --dir: right;
}

.divider-label {
  font-size: 10px;
  font-weight: 800;
  color: color-mix(in srgb, var(--focus-color) 60%, transparent);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  white-space: nowrap;
  font-family: inherit;
}

/* Task list */
.task-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 10px 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.task-list::-webkit-scrollbar {
  width: 4px;
}

.task-list::-webkit-scrollbar-track {
  background: transparent;
}

.task-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 2px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 20px;
  color: rgba(255, 255, 255, 0.3);
  font-size: 13px;
  flex-shrink: 0;
}

/* Load more button */
.load-more-btn {
  display: block;
  width: 100%;
  padding: 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px dashed rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.4);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
}

.load-more-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.18);
  color: rgba(255, 255, 255, 0.7);
}

/* Completed section */
.completed-section {
  margin-top: 12px;
  flex-shrink: 0;
}

.completed-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.4);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.2s;
  font-family: inherit;
  width: 100%;
  text-align: left;
}

.completed-header:hover {
  color: rgba(255, 255, 255, 0.6);
}

.completed-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* Collapse transition */
.collapse-enter-active,
.collapse-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}

.collapse-enter-from,
.collapse-leave-to {
  opacity: 0;
  max-height: 0;
}

.collapse-enter-to,
.collapse-leave-from {
  max-height: 1000px;
}

</style>
