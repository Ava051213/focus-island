<script setup lang="ts">
import { useSettings, type IslandDisplayMode } from '../composables/useSettings'
import { invoke } from '@tauri-apps/api/core'

const { settings } = useSettings()

const displayModeOptions: Array<{ id: IslandDisplayMode; label: string; hint: string }> = [
  { id: 'resident', label: '常驻', hint: '一直在屏幕上陪着你' },
  { id: 'dock', label: '边缘停靠', hint: '贴边藏成一条，鼠标来了才展开' },
]

// 贴边参数写回后由主窗口的 watch 重新摆位（跨窗口同步驱动）
function resetIslandPosition() {
  settings.value.islandEdge = 'top'
  settings.value.islandEdgeRatio = null
}

// 重置是摆位请求，直接让主窗口落位，不等同步链路
function resetPosition() {
  resetIslandPosition()
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

    <div v-if="settings.islandDisplayMode === 'resident'" class="toggle-row">
      <div class="toggle-copy">
        <span class="toggle-label">闲置就悄悄让开</span>
        <span class="toggle-hint">3 分钟没人理就缩到边上，鼠标碰到再出来</span>
      </div>
      <label class="switch" aria-label="闲置收起">
        <input v-model="settings.islandPeek" type="checkbox" />
        <span class="switch-track"></span>
      </label>
    </div>

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
        拖乱了？回到默认位置
      </button>
    </div>
  </div>
</template>

<style scoped>
@reference "../styles.css";

.settings-section {
  padding: 10px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.section-title {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  font-weight: 500;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
}

.section-subtitle {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  font-weight: 500;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
}

.mode-toggle {
  display: flex;
  align-items: center;
  border: 1px solid color-mix(in srgb, var(--focus-color) 82%, transparent);
  border-radius: 999px;
  overflow: hidden;
  width: fit-content;
  max-width: 100%;
}

.mode-btn {
  appearance: none;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.85);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  height: 28px;
  padding: 0 14px;
  cursor: pointer;
  transition: background 0.22s ease, color 0.22s ease;
  white-space: nowrap;
}

.mode-btn + .mode-btn {
  border-left: 1px solid color-mix(in srgb, var(--focus-color) 58%, transparent);
}

.mode-btn:hover {
  background: color-mix(in srgb, var(--focus-color) 15%, transparent);
}

.mode-btn.active {
  background: var(--focus-color);
  color: #fff;
}

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 10px;
}

.toggle-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.toggle-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
}

.toggle-hint {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  line-height: 1.4;
}

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

.ghost-btn {
  appearance: none;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 999px;
  background: transparent;
  color: rgba(255, 255, 255, 0.75);
  font-size: 11px;
  line-height: 1;
  height: 24px;
  padding: 0 10px;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
}

.ghost-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  border-color: rgba(255, 255, 255, 0.3);
}

.switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  width: 42px;
  height: 24px;
  flex-shrink: 0;
  cursor: pointer;
}

.switch input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.switch-track {
  position: relative;
  width: 42px;
  height: 24px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.14);
  transition: background 0.2s ease, border-color 0.2s ease;
}

.switch-track::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
  transition: transform 0.2s ease, background 0.2s ease;
}

.switch input:checked + .switch-track {
  background: color-mix(in srgb, var(--focus-color) 72%, rgba(255, 255, 255, 0.12));
  border-color: color-mix(in srgb, var(--focus-color) 88%, transparent);
}

.switch input:checked + .switch-track::after {
  transform: translateX(18px);
  background: #fff;
}
</style>
