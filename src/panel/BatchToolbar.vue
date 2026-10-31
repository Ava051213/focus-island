<script setup lang="ts">
defineProps<{
  allSelected: boolean
  someSelected: boolean
  selectedCount: number
  selectionMode: boolean
  olderThan7dCount: number
  totalCount: number
}>()

const emit = defineEmits<{
  toggleAll: []
  toggleMode: []
  restoreSelected: []
  deleteSelected: []
  deleteOlderThan7d: []
  deleteAllCompleted: []
}>()
</script>

<template>
  <div class="batch-toolbar" @click.stop>
    <div class="batch-left">
      <button
        class="batch-select-all"
        :class="{ checked: allSelected, partial: someSelected && !allSelected }"
        @click="emit('toggleAll')"
        :title="allSelected ? '取消全选' : '全选'"
      >
        <svg v-if="allSelected" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>
        <span v-else-if="someSelected" class="partial-bar"></span>
      </button>
      <span class="batch-hint" @click="emit('toggleMode')">
        {{ someSelected ? `已选 ${selectedCount}` : (selectionMode ? '点击任务进行选择' : '批量管理') }}
      </span>
    </div>
    <div class="batch-right">
      <button v-if="someSelected" class="batch-btn restore" @click="emit('restoreSelected')" title="恢复所选任务">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
        <span>恢复</span>
      </button>
      <button v-if="someSelected" class="batch-btn danger" @click="emit('deleteSelected')" title="删除所选">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>
        <span>删除所选</span>
      </button>
      <button v-if="olderThan7dCount > 0" class="batch-btn subtle" @click="emit('deleteOlderThan7d')" title="删除 7 天前的已完成任务">
        清理7天前
      </button>
      <button v-if="totalCount > 0" class="batch-btn subtle danger" @click="emit('deleteAllCompleted')" title="删除全部已完成任务">
        全部删除
      </button>
    </div>
  </div>
</template>

<style scoped>
@reference "../styles.css";

.batch-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

.batch-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.batch-right {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.batch-select-all {
  width: 16px;
  height: 16px;
  border-radius: 5px;
  background: transparent;
  border: 1.5px solid rgba(255, 255, 255, 0.25);
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  flex-shrink: 0;
  padding: 0;
}

.batch-select-all:hover {
  border-color: var(--focus-color);
  background: color-mix(in srgb, var(--focus-color) 15%, transparent);
  color: var(--focus-color);
}

.batch-select-all.checked {
  border-color: color-mix(in srgb, var(--focus-color) 70%, transparent);
  background: color-mix(in srgb, var(--focus-color) 25%, transparent);
  color: var(--focus-color);
}

.batch-select-all.partial {
  border-color: color-mix(in srgb, var(--focus-color) 70%, transparent);
  background: color-mix(in srgb, var(--focus-color) 10%, transparent);
  color: var(--focus-color);
}

.batch-select-all .partial-bar {
  width: 8px;
  height: 2px;
  background: var(--focus-color);
  border-radius: 1px;
  display: block;
}

.batch-hint {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.batch-hint:hover {
  color: rgba(255, 255, 255, 0.7);
}

.batch-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.55);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.batch-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.18);
  color: #fff;
}

.batch-btn.restore {
  color: color-mix(in srgb, var(--break-color) 80%, #fff);
  border-color: color-mix(in srgb, var(--break-color) 20%, rgba(255, 255, 255, 0.08));
}

.batch-btn.restore:hover {
  background: color-mix(in srgb, var(--break-color) 15%, transparent);
  border-color: color-mix(in srgb, var(--break-color) 35%, transparent);
  color: var(--break-color);
}

.batch-btn.danger {
  color: rgba(248, 113, 113, 0.8);
  border-color: rgba(248, 113, 113, 0.15);
}

.batch-btn.danger:hover {
  background: rgba(248, 113, 113, 0.12);
  border-color: rgba(248, 113, 113, 0.35);
  color: #fca5a5;
}

.batch-btn.subtle {
  background: transparent;
  border-color: transparent;
  color: rgba(255, 255, 255, 0.35);
}

.batch-btn.subtle:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.8);
}

.batch-btn.subtle.danger:hover {
  background: rgba(248, 113, 113, 0.1);
  color: #fca5a5;
}
</style>
