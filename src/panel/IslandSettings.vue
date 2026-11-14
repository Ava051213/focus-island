<script setup lang="ts">
import { useSettings, type IslandDisplayMode } from '../composables/useSettings'
import { invoke } from '@tauri-apps/api/core'
import AppSwitch from './AppSwitch.vue'

const { settings } = useSettings()

const displayModeOptions: Array<{ id: IslandDisplayMode; label: string; hint: string }> = [
  { id: 'resident', label: '常驻', hint: '一直在屏幕上' },
  { id: 'dock', label: '边缘停靠', hint: '贴边藏成一条，鼠标来了才展开' },
]

// 贴边参数写回后由主窗口的 watch 重新摆位（跨窗口同步驱动）
function resetPosition() {
  settings.value.islandEdge = 'top'
  settings.value.islandEdgeRatio = null
  void invoke('place_island', { edge: 'top', ratio: null })
}
</script>

<template>
  <div class="settings-section">
    <div class="section-title">灵动岛</div>

    <div class="section-subtitle">显示方式</div>
    <div class="mode-toggle" role="group" aria-label="灵动岛显示方式">
      <button
        v-for="opt in displayModeOptions"
        :key="opt.id"
        type="button"
        class="mode-btn"
        :class="{ active: settings.islandDisplayMode === opt.id }"
        @click="settings.islandDisplayMode = opt.id"
        :title="opt.hint"
      >
        {{ opt.label }}
      </button>
    </div>

    <AppSwitch
      v-if="settings.islandDisplayMode === 'resident'"
      v-model="settings.islandPeek"
      label="闲置时收起"
      hint="3 分钟没有操作就缩到屏幕边，鼠标碰到再出来"
    />

    <div class="slider-row">
      <label class="slider-label">通透感</label>
      <input
        type="range"
        class="opacity-slider"
        min="0"
        max="0.9"
        step="0.01"
        v-model.number="settings.islandOpacity"
      />
      <span class="slider-value">{{ Math.round(settings.islandOpacity * 100) }}%</span>
    </div>
    <div class="slider-row">
      <label class="slider-label">大小</label>
      <input
        type="range"
        class="opacity-slider"
        min="0.5"
        max="1.5"
        step="0.1"
        v-model.number="settings.islandScale"
      />
      <span class="slider-value">{{ Math.round(settings.islandScale * 100) }}%</span>
    </div>
    <div class="slider-row">
      <label class="slider-label">位置</label>
      <button type="button" class="ghost-btn" @click="resetPosition">
        回到默认位置
      </button>
    </div>
  </div>
</template>

<style scoped>
@reference "../styles.css";

.slider-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}

.slider-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  width: 40px;
  flex-shrink: 0;
}

.opacity-slider {
  flex: 1;
  appearance: none;
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.12);
  outline: none;
}

.opacity-slider::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  cursor: pointer;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
}

.slider-value {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  min-width: 32px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
