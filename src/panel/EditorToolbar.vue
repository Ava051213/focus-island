<script setup lang="ts">
defineProps<{
  activeFormats: { bold: boolean; italic: boolean }
  currentColor: string
  colorPickerOpen: boolean
}>()

defineEmits<{
  toggleBold: []
  toggleItalic: []
  toggleColorPicker: []
  selectColor: [color: string]
  insertCheckbox: []
  insertDivider: []
  uploadImage: []
}>()

const colors = [
  { value: '#ffffff', label: '白色' },
  { value: '#f87171', label: '红色' },
  { value: '#fbbf24', label: '黄色' },
  { value: '#4ade80', label: '绿色' },
  { value: '#60a5fa', label: '蓝色' },
  { value: '#a78bfa', label: '紫色' },
  { value: '#f472b6', label: '粉色' },
]
</script>

<template>
  <div class="editor-toolbar">
    <button
      class="toolbar-btn"
      :class="{ active: activeFormats.bold }"
      @click="$emit('toggleBold')"
      title="粗体 (Ctrl+B)"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/>
        <path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/>
      </svg>
    </button>

    <button
      class="toolbar-btn"
      :class="{ active: activeFormats.italic }"
      @click="$emit('toggleItalic')"
      title="斜体 (Ctrl+I)"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="19" y1="4" x2="10" y2="4"/>
        <line x1="14" y1="20" x2="5" y2="20"/>
        <line x1="15" y1="4" x2="9" y2="20"/>
      </svg>
    </button>

    <div class="toolbar-divider"></div>

    <div class="color-picker" :class="{ active: colorPickerOpen }">
      <button
        class="toolbar-btn color-btn"
        title="文字颜色"
        @click="$emit('toggleColorPicker')"
        :style="{ '--current-color': currentColor }"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 3v6M15 3v6M9 9h6M8 21h8M12 9v12"/>
        </svg>
        <span class="color-indicator" :style="{ backgroundColor: currentColor }"></span>
      </button>
      <div v-show="colorPickerOpen" class="color-dropdown">
        <button
          v-for="color in colors"
          :key="color.value"
          class="color-option"
          :class="{ active: currentColor === color.value }"
          :style="{ color: color.value }"
          :title="color.label"
          @click.stop="$emit('selectColor', color.value)"
        >
          A
        </button>
      </div>
    </div>

    <div class="toolbar-divider"></div>

    <button class="toolbar-btn" @click="$emit('insertCheckbox')" title="打个勾选框">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
        <path d="M9 12l2 2 4-4"/>
      </svg>
    </button>

    <button class="toolbar-btn" @click="$emit('insertDivider')" title="画条分割线">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
    </button>

    <button class="toolbar-btn" @click="$emit('uploadImage')" title="放张图">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <polyline points="21 15 16 10 5 21"/>
      </svg>
    </button>
  </div>
</template>

<style scoped>
@reference "../styles.css";

.editor-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

.toolbar-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: transparent;
  border: 1px solid transparent;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.toolbar-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.toolbar-btn.active {
  background: color-mix(in srgb, var(--focus-color) 20%, transparent);
  border-color: color-mix(in srgb, var(--focus-color) 50%, transparent);
  color: var(--focus-color);
}

.toolbar-divider {
  width: 1px;
  height: 18px;
  background: rgba(255, 255, 255, 0.1);
  margin: 0 4px;
}

.color-picker {
  position: relative;
}

.color-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  display: flex;
  gap: 4px;
  padding: 6px;
  background: rgba(28, 28, 32, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 100;
}

.color-option {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  transition: all 0.2s;
}

.color-option:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.2);
  transform: scale(1.05);
}

.color-option.active {
  background: rgba(255, 255, 255, 0.2);
  border-color: currentColor;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.1);
}

.color-picker.active .color-btn {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.2);
  color: #fff;
}

.color-btn {
  position: relative;
}

.color-indicator {
  position: absolute;
  bottom: 3px;
  left: 50%;
  transform: translateX(-50%);
  width: 14px;
  height: 3px;
  border-radius: 2px;
  transition: background-color 0.2s;
}
</style>
