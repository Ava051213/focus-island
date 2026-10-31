<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { addDays, toLocalDateStr } from '../utils/date'
import { getCategoryColor } from '../composables/useMemos'

const props = defineProps<{
  menu: { x: number; y: number; completed: boolean }
  groups: Array<{ id: string; name: string; color: string }>
}>()

const emit = defineEmits<{
  setDate: [dateStr: string]
  moveToGroup: [groupId: string | null]
  restore: []
  delete: []
}>()

const menuEl = ref<HTMLElement | null>(null)
const pos = ref({ x: props.menu.x, y: props.menu.y })

// 贴着窗口右/下边缘右键时把菜单翻到另一侧，避免被裁掉。
// 用组件自身的 ref 测量，不再 querySelector('.context-menu')。
function measure() {
  const el = menuEl.value
  if (!el) return
  const width = el.offsetWidth
  const height = el.offsetHeight
  let { x, y } = props.menu
  if (x + width > window.innerWidth) x = Math.max(0, x - width)
  if (y + height > window.innerHeight) y = Math.max(0, y - height)
  pos.value = { x, y }
}

onMounted(async () => {
  await nextTick()
  measure()
})

watch(
  () => props.menu,
  async () => {
    pos.value = { x: props.menu.x, y: props.menu.y }
    await nextTick()
    measure()
  },
)

const submenuOnLeft = computed(() => pos.value.x > 200)

function pickToday() {
  emit('setDate', toLocalDateStr(new Date()))
}

function pickTomorrow() {
  emit('setDate', toLocalDateStr(addDays(new Date(), 1)))
}
</script>

<template>
  <teleport to=".panel-inner">
    <div
      ref="menuEl"
      class="context-menu"
      :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
      @click.stop
    >
      <template v-if="!menu.completed">
        <button class="context-menu-item" @click="pickToday">今天到期</button>
        <button class="context-menu-item" @click="pickTomorrow">明天到期</button>

        <div class="context-menu-item-with-submenu">
          <button class="context-menu-item submenu-trigger">
            <span>移动至分组</span>
            <span class="submenu-arrow">›</span>
          </button>
          <div class="context-sub-menu" :class="{ 'pos-left': submenuOnLeft }">
            <button class="context-menu-item flex-item" @click="emit('moveToGroup', null)">
              <span class="group-dot-sm" style="background-color: rgba(255, 255, 255, 0.2)"></span>
              <span class="context-menu-text">无分组</span>
            </button>
            <div v-if="groups.length > 0" class="context-menu-divider"></div>
            <button
              v-for="group in groups"
              :key="group.id"
              class="context-menu-item flex-item"
              @click="emit('moveToGroup', group.id)"
            >
              <span class="group-dot-sm" :style="{ backgroundColor: getCategoryColor(group.color).icon }"></span>
              <span class="context-menu-text">{{ group.name }}</span>
            </button>
          </div>
        </div>

        <div class="context-menu-divider"></div>
      </template>
      <template v-else>
        <button class="context-menu-item" @click="emit('restore')">恢复</button>
        <div class="context-menu-divider"></div>
      </template>
      <button class="context-menu-item danger" @click="emit('delete')">删除</button>
    </div>
  </teleport>
</template>

<style scoped>
@reference "../styles.css";

.context-menu {
  position: fixed;
  z-index: 1000;
  min-width: 130px;
  padding: 4px;
  border-radius: 10px;
  background: rgba(28, 28, 32, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(12px);
}

.context-menu-item {
  display: block;
  width: 100%;
  padding: 7px 14px;
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

.context-menu-item:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.context-menu-item.danger {
  color: #f87171;
}

.context-menu-item.danger:hover {
  background: rgba(248, 113, 113, 0.12);
  color: #fca5a5;
}

.context-menu-item.flex-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.context-menu-item.submenu-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.context-menu-item-with-submenu {
  position: relative;
}

.context-sub-menu {
  position: absolute;
  left: 100%;
  top: -4px;
  min-width: 130px;
  padding: 4px;
  border-radius: 10px;
  background: rgba(28, 28, 32, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(12px);
  display: none;
  z-index: 1010;
  margin-left: 4px;
}

.context-sub-menu.pos-left {
  left: auto;
  right: 100%;
  margin-left: 0;
  margin-right: 4px;
}

.context-menu-item-with-submenu:hover .context-sub-menu {
  display: block;
}

.context-menu-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.08);
  margin: 4px 8px;
}

.submenu-arrow {
  opacity: 0.4;
  font-size: 11px;
  line-height: 1;
}

.context-menu-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
