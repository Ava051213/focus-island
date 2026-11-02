<script setup lang="ts">
defineProps<{
  position: { x: number; y: number }
  hasSelection: boolean
}>()

defineEmits<{
  copy: []
  paste: []
  pastePlainText: []
  selectAll: []
}>()
</script>

<template>
  <div
    class="context-menu"
    :style="{ left: position.x + 'px', top: position.y + 'px' }"
    @click.stop
  >
    <div class="context-menu-group">
      <button class="context-menu-item" :disabled="!hasSelection" @click="$emit('copy')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
        </svg>
        <span>复制</span>
      </button>
      <button class="context-menu-item" @click="$emit('paste')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/>
          <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
        </svg>
        <span>粘贴</span>
      </button>
      <button class="context-menu-item" @click="$emit('pastePlainText')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
        <span>粘贴为纯文本</span>
      </button>
      <button class="context-menu-item" @click="$emit('selectAll')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 7V4h3M4 17v3h3M20 7V4h-3M20 17v3h-3M9 9h6v6H9z"/>
        </svg>
        <span>全选</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
@reference "../styles.css";

.context-menu {
  position: fixed;
  z-index: 2000;
  min-width: 180px;
  max-width: 240px;
  background: rgba(28, 28, 32, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 6px 0;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(16px);
  font-size: 13px;
  user-select: none;
  animation: contextMenuIn 0.12s ease-out;
}

@keyframes contextMenuIn {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.context-menu-group {
  display: flex;
  flex-direction: column;
  padding: 0 6px;
}

.context-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px 10px;
  border-radius: 6px;
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.85);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
  text-align: left;
  font-family: inherit;
}

.context-menu-item:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.context-menu-item:active:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
}

.context-menu-item:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
</style>
