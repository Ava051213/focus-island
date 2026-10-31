<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { getCategoryColor } from '../composables/useMemos'

interface TabItem {
  key: string
  label: string
  count: number
}

const props = defineProps<{
  tabs: TabItem[]
  activeTab: string
  groups: Array<{ id: string; name: string; color: string }>
}>()

const emit = defineEmits<{
  select: [key: string]
  toggleGroupDialog: []
}>()

const tabScrollRef = ref<HTMLElement | null>(null)
const hasOverflow = ref(false)
const showTabsDropdown = ref(false)

const groupColors = computed(() => {
  const map: Record<string, string> = {}
  for (const group of props.groups) {
    map[group.id] = getCategoryColor(group.color).icon
  }
  return map
})

// 内置分类不带彩色圆点，只有分组 tab 才有
function isGroupTab(key: string): boolean {
  if (key === 'today' || key === 'tomorrow' || key === 'week' || key === 'later' || key === 'completed') {
    return false
  }
  return Boolean(groupColors.value[key])
}

function checkOverflow() {
  const el = tabScrollRef.value
  if (!el) return
  hasOverflow.value = el.scrollWidth > el.clientWidth
}

function scrollActiveTabIntoView(behavior: ScrollBehavior) {
  nextTick(() => {
    setTimeout(() => {
      const el = tabScrollRef.value?.querySelector('.tab-item.active')
      if (el) {
        el.scrollIntoView({ behavior, block: 'nearest', inline: 'center' })
      }
    }, 50)
  })
}

function selectTab(key: string) {
  showTabsDropdown.value = false
  emit('select', key)
  scrollActiveTabIntoView('smooth')
}

// 横向滚轮走阻尼动画，避免一格一跳
let targetScrollLeft = 0
let currentScrollLeft = 0
let isScrolling = false

function handleWheel(e: WheelEvent) {
  if (!tabScrollRef.value) return

  const el = tabScrollRef.value

  if (!isScrolling) {
    targetScrollLeft = el.scrollLeft
    currentScrollLeft = el.scrollLeft
  }

  const multiplier = 0.35
  const maxScroll = el.scrollWidth - el.clientWidth

  targetScrollLeft = Math.max(0, Math.min(maxScroll, targetScrollLeft + e.deltaY * multiplier))

  if (!isScrolling) {
    isScrolling = true
    const animate = () => {
      if (!tabScrollRef.value) {
        isScrolling = false
        return
      }

      const container = tabScrollRef.value

      // 点击居中之类的被动滚动会和这里的插值打架，先同步回来
      if (Math.abs(container.scrollLeft - Math.round(currentScrollLeft)) > 1) {
        currentScrollLeft = container.scrollLeft
      }

      const diff = targetScrollLeft - currentScrollLeft

      if (Math.abs(diff) > 0.5) {
        currentScrollLeft += diff * 0.28
        container.scrollLeft = Math.round(currentScrollLeft)
        requestAnimationFrame(animate)
      } else {
        currentScrollLeft = targetScrollLeft
        container.scrollLeft = Math.round(targetScrollLeft)
        isScrolling = false
      }
    }
    requestAnimationFrame(animate)
  }
}

let resizeObserver: ResizeObserver | null = null

function observeTabOverflow() {
  if (resizeObserver || !tabScrollRef.value) return
  checkOverflow()
  resizeObserver = new ResizeObserver(() => {
    checkOverflow()
  })
  resizeObserver.observe(tabScrollRef.value)
}

function stopObservingTabOverflow() {
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
}

// 点页面其它地方收起下拉；header 自身的点击有 .stop，不会走到这里
function onDocumentClick(e: MouseEvent) {
  if (!showTabsDropdown.value) return
  const target = e.target as HTMLElement | null
  if (target?.closest('.tabs-dropdown-container')) return
  showTabsDropdown.value = false
}

onMounted(() => {
  observeTabOverflow()
  window.addEventListener('click', onDocumentClick)
  // 从详情页返回时让当前 tab 立刻居中，不要动画
  scrollActiveTabIntoView('auto')
})

onActivated(() => {
  observeTabOverflow()
})

onDeactivated(() => {
  stopObservingTabOverflow()
  showTabsDropdown.value = false
})

onBeforeUnmount(() => {
  stopObservingTabOverflow()
  window.removeEventListener('click', onDocumentClick)
})

// tab 数量或分组变化会改变宽度，需要重新判断是否溢出
watch(
  () => props.tabs,
  () => {
    nextTick(() => {
      checkOverflow()
    })
  },
  { deep: true },
)

watch(
  () => props.activeTab,
  () => {
    scrollActiveTabIntoView('smooth')
  },
)
</script>

<template>
  <header class="todo-header" @click.stop>
    <div class="tab-scroll" ref="tabScrollRef" @wheel.prevent="handleWheel">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-item"
        :class="{ active: activeTab === tab.key }"
        @click="selectTab(tab.key)"
      >
        <span
          v-if="isGroupTab(tab.key)"
          class="tab-group-dot"
          :style="{ backgroundColor: groupColors[tab.key] }"
        ></span>
        <span class="tab-label">{{ tab.label }}</span>
        <span v-if="tab.count > 0" class="tab-count">{{ tab.count }}</span>
      </button>
    </div>

    <!-- 分类多到横向放不下时才出现下拉 -->
    <div v-if="hasOverflow" class="tabs-dropdown-container">
      <button
        class="header-btn dropdown-trigger"
        :class="{ active: showTabsDropdown }"
        @click.stop="showTabsDropdown = !showTabsDropdown"
        title="选择分类"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>
      <div v-if="showTabsDropdown" class="tabs-dropdown-menu">
        <button
          v-for="tab in tabs"
          :key="'drop-' + tab.key"
          class="tabs-dropdown-item"
          :class="{ active: activeTab === tab.key }"
          @click="selectTab(tab.key)"
        >
          <div class="tabs-drop-left">
            <span
              v-if="isGroupTab(tab.key)"
              class="tab-group-dot"
              :style="{ backgroundColor: groupColors[tab.key] }"
            ></span>
            <span class="tabs-drop-label">{{ tab.label }}</span>
          </div>
          <span v-if="tab.count > 0" class="tabs-drop-count">{{ tab.count }}</span>
        </button>
      </div>
    </div>

    <button class="header-btn gear-btn" @click.stop="emit('toggleGroupDialog')" title="管理分组">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1 1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c0 .66.39 1.26 1 1.51.16.07.33.1.51.1H21a2 2 0 0 1 0 4h-.09c-.66 0-1.26.39-1.51 1Z"/>
      </svg>
    </button>
  </header>
</template>

<style scoped>
@reference "../styles.css";

/* Header with integrated tabs */
.todo-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

.header-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  flex-shrink: 0;
}

.header-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.16);
  color: #fff;
}

.tab-scroll {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 4px;
  overflow-x: auto;
  scrollbar-width: none;
}

.tab-scroll::-webkit-scrollbar {
  display: none;
}

.tab-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid transparent;
  color: rgba(255, 255, 255, 0.5);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  font-family: inherit;
  white-space: nowrap;
  flex-shrink: 0;
}

.tab-item:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.8);
}

.tab-item.active {
  background: color-mix(in srgb, var(--focus-color) 15%, transparent);
  border-color: color-mix(in srgb, var(--focus-color) 30%, transparent);
  color: var(--focus-color);
}

.tab-label {
  line-height: 1;
}

.tab-count {
  font-size: 10px;
}

.tab-group-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* Categories Dropdown Container */
.tabs-dropdown-container {
  position: relative;
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.dropdown-trigger {
  position: relative;
  transition: transform 0.2s ease, background 0.2s ease, border-color 0.2s ease;
}

.dropdown-trigger:hover {
  transform: translateY(0.5px);
}

.dropdown-trigger.active {
  background: color-mix(in srgb, var(--focus-color) 15%, transparent);
  border-color: color-mix(in srgb, var(--focus-color) 40%, transparent);
  color: var(--focus-color);
  transform: rotate(180deg);
}

/* Dropdown Menu */
.tabs-dropdown-menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 140px;
  background: rgba(30, 30, 35, 0.85);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 5px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.3);
  z-index: 1000;
  transform-origin: top right;
  animation: dropdown-fade-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes dropdown-fade-in {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(-5px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.tabs-dropdown-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 7px 10px;
  border-radius: 6px;
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.65);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.tabs-dropdown-item:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.95);
  padding-left: 12px; /* Subtle hover slide-in micro-animation */
}

.tabs-dropdown-item.active {
  background: color-mix(in srgb, var(--focus-color) 12%, transparent);
  color: var(--focus-color);
  font-weight: 600;
}

.tabs-drop-left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.tabs-drop-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1;
}

.tabs-drop-count {
  font-size: 9px;
  padding: 1.5px 5px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.5);
  font-weight: 600;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.tabs-dropdown-item:hover .tabs-drop-count {
  background: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.85);
}

.tabs-dropdown-item.active .tabs-drop-count {
  background: color-mix(in srgb, var(--focus-color) 20%, transparent);
  color: var(--focus-color);
}
</style>
