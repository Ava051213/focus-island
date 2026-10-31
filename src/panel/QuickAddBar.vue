<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getCategoryColor } from '../composables/useMemos'
import { toLocalDateStr } from '../utils/date'
import CalendarDatePicker from './CalendarDatePicker.vue'

const props = defineProps<{
  groups: Array<{ id: string; name: string; color: string }>
  activeTab: string
}>()

const emit = defineEmits<{
  submit: [payload: { title: string; dueDate: string | null; groupId: string | null }]
}>()

const newTitle = ref('')
const selectedGroupId = ref<string | null>(null)
const selectedDate = ref<string | null>(toLocalDateStr(new Date()))
const showDatePicker = ref(false)
const showGroupDropdown = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)

const SYSTEM_TABS = ['today', 'tomorrow', 'week', 'later', 'completed']

// 停在某个分组 tab 上时，新建任务默认落到该分组
watch(
  () => props.activeTab,
  (tab) => {
    selectedGroupId.value = SYSTEM_TABS.includes(tab) ? null : tab
  },
  { immediate: true },
)

const selectedGroupLabel = computed(() => {
  if (!selectedGroupId.value) return '无分组'
  return props.groups.find(g => g.id === selectedGroupId.value)?.name ?? '无分组'
})

const selectedGroupColor = computed(() =>
  getCategoryColor(props.groups.find(g => g.id === selectedGroupId.value)?.color ?? 'yellow').icon,
)

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

function submit() {
  const title = newTitle.value.trim()
  if (!title) return
  emit('submit', { title, dueDate: selectedDate.value, groupId: selectedGroupId.value })
  newTitle.value = ''
  // 连续录入：提交后把焦点留在输入框
  inputRef.value?.focus()
}

// 点组件之外收起两个下拉；组件内部点击有 .stop，到不了 window
function onDocumentClick() {
  showGroupDropdown.value = false
  showDatePicker.value = false
}

onMounted(() => {
  window.addEventListener('click', onDocumentClick)
})

onBeforeUnmount(() => {
  window.removeEventListener('click', onDocumentClick)
})
</script>

<template>
  <div class="quick-add" @click.stop>
    <div class="quick-add-input-row">
      <button
        class="inline-chip group-chip"
        :class="{ active: showGroupDropdown }"
        @click.stop="showGroupDropdown = !showGroupDropdown; showDatePicker = false"
        :title="'分组: ' + selectedGroupLabel"
      >
        <span v-if="selectedGroupId" class="group-dot" :style="{ backgroundColor: selectedGroupColor }"></span>
        <svg v-else width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <span class="chip-label">{{ selectedGroupLabel }}</span>
      </button>
      <input
        ref="inputRef"
        v-model="newTitle"
        class="quick-add-input"
        placeholder="添加任务..."
        @keydown.enter="submit"
        @click.stop
        @focus="showGroupDropdown = false; showDatePicker = false"
      />
      <button
        class="inline-chip date-chip"
        :class="{ active: showDatePicker }"
        @click.stop="showDatePicker = !showDatePicker; showGroupDropdown = false"
        :title="'到期: ' + (formatShortDate(selectedDate) || '无日期')"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        <span class="chip-label">{{ formatShortDate(selectedDate) || '无日期' }}</span>
      </button>
    </div>
    <!-- Group dropdown popup -->
    <div v-if="showGroupDropdown" class="chip-dropdown group-dropdown-menu" @click.stop>
      <button class="group-dropdown-item" :class="{ active: !selectedGroupId }" @click="selectedGroupId = null; showGroupDropdown = false">
        无分组
      </button>
      <button
        v-for="group in groups"
        :key="group.id"
        class="group-dropdown-item"
        :class="{ active: selectedGroupId === group.id }"
        @click="selectedGroupId = group.id; showGroupDropdown = false"
      >
        <span class="group-dot" :style="{ backgroundColor: getCategoryColor(group.color).icon }"></span>
        {{ group.name }}
      </button>
    </div>
    <!-- Date picker popup -->
    <div v-if="showDatePicker" class="chip-dropdown date-picker-menu" @click.stop>
      <CalendarDatePicker
        v-model="selectedDate"
        :clearable="true"
        @close="showDatePicker = false"
      />
    </div>
  </div>
</template>

<style scoped>
@reference "../styles.css";

/* Quick-add row */
.quick-add {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  flex-shrink: 0;
}

.quick-add-input-row {
  display: flex;
  align-items: center;
  gap: 0;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  overflow: hidden;
  transition: all 0.2s;
}

.quick-add-input-row:focus-within {
  border-color: color-mix(in srgb, var(--focus-color) 50%, transparent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--focus-color) 12%, transparent);
}

.inline-chip {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 5px 8px;
  background: none;
  border: none;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.45);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
  flex-shrink: 0;
}

.inline-chip:hover,
.inline-chip.active {
  color: rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.05);
}

.chip-label {
  max-width: 48px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.group-chip .group-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.date-chip {
  border-right: none;
  border-left: 1px solid rgba(255, 255, 255, 0.08);
}

.quick-add-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  padding: 7px 10px;
  font-size: 13px;
  color: #fff;
  outline: none;
  font-family: inherit;
}

.quick-add-input::placeholder {
  color: rgba(255, 255, 255, 0.3);
}

.chip-dropdown {
  position: absolute;
  top: calc(100% - 10px);
  z-index: 50;
  min-width: 140px;
  padding: 4px;
  border-radius: 10px;
  background: rgba(28, 28, 32, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(12px);
  margin-top: 4px;
}

.group-dropdown-menu {
  left: 12px;
}

.date-picker-menu {
  right: 12px;
  min-width: 120px;
}

.group-dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 12px;
  border-radius: 6px;
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
  text-align: left;
}

.group-dropdown-item:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.group-dropdown-item.active {
  background: color-mix(in srgb, var(--focus-color) 15%, transparent);
  color: var(--focus-color);
}
</style>
