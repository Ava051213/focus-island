<script setup lang="ts">
import { emit } from '@tauri-apps/api/event'
import { useSettings, presetThemes, type ColorMode, type IslandDisplayMode } from '../composables/useSettings'
import { useRewardUnlocks } from '../composables/useWeeklyGoals'
import type { BubbleTone } from '../utils/settingsMigration'

const { settings } = useSettings()
const { unlockedRewards } = useRewardUnlocks()

function isThemeLocked(theme: (typeof presetThemes)[number]): boolean {
  return !!theme.rewardId && !unlockedRewards.value.some(id => id === theme.rewardId)
}

const opacityPercent = (v: number) => Math.round(v * 100) + '%'

const colorModeOptions: Array<{ id: ColorMode; label: string }> = [
  { id: 'dark', label: '暗暗的' },
  { id: 'light', label: '亮亮的' },
  { id: 'system', label: '跟着系统' },
]

const displayModeOptions: Array<{ id: IslandDisplayMode; label: string; hint: string }> = [
  { id: 'resident', label: '常驻', hint: '一直在屏幕上面陪着你呀' },
  { id: 'dock', label: '边缘停靠', hint: '贴边藏成一条，鼠标来了才展开喔' },
]

const toneOptions: Array<{ id: BubbleTone; label: string; hint: string }> = [
  { id: 'quiet', label: '安静', hint: '大概一小时冒一句' },
  { id: 'normal', label: '正常', hint: '二十来分钟一句' },
  { id: 'lively', label: '勤快', hint: '十来分钟一句，很黏人' },
]

function switchColorMode(mode: ColorMode) {
  if (settings.value.colorMode === mode) return
  settings.value.colorMode = mode
}

// 贴边参数写回后由主窗口的 watch 重新摆位（跨窗口同步驱动）
function resetIslandPosition() {
  settings.value.islandEdge = 'top'
  settings.value.islandEdgeRatio = null
}

// 让主窗口直接吐一个泡泡，验收用
function tryBubble() {
  void emit('island-bubble', { kind: 'test' })
}
</script>

<template>
  <div class="settings-section">
    <div class="section-title">长什么样</div>
    <div class="mode-toggle" role="group" aria-label="主题模式">
      <button
        v-for="option in colorModeOptions"
        :key="option.id"
        type="button"
        class="mode-btn"
        :class="{ active: settings.colorMode === option.id }"
        @click="switchColorMode(option.id)"
      >
        {{ option.label }}
      </button>
    </div>

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
    <div v-if="settings.islandDisplayMode === 'resident'" class="peek-row">
      <div class="peek-copy">
        <span class="peek-label">闲置就悄悄让开</span>
        <span class="peek-hint">3 分钟没人理就缩到边上，鼠标碰到再出来</span>
      </div>
      <label class="switch" aria-label="闲置收起">
        <input v-model="settings.islandPeek" type="checkbox" />
        <span class="switch-track"></span>
      </label>
    </div>

    <div class="section-subtitle">吐泡泡</div>
    <div class="peek-row">
      <div class="peek-copy">
        <span class="peek-label">让未晚随口说话</span>
        <span class="peek-hint">岛会冒小泡泡，飘两秒就破，点一下进面板</span>
      </div>
      <label class="switch" aria-label="吐泡泡">
        <input v-model="settings.bubbles.enabled" type="checkbox" />
        <span class="switch-track"></span>
      </label>
    </div>
    <template v-if="settings.bubbles.enabled">
      <div class="mode-toggle bubble-tone" role="group" aria-label="泡泡密度">
        <button
          v-for="t in toneOptions"
          :key="t.id"
          type="button"
          class="mode-btn"
          :class="{ active: settings.bubbles.tone === t.id }"
          :title="t.hint"
          @click="settings.bubbles.tone = t.id"
        >
          {{ t.label }}
        </button>
      </div>
      <div class="peek-row">
        <div class="peek-copy">
          <span class="peek-label">撒撒娇</span>
          <span class="peek-hint">时不时冒一句娇气的悄悄话</span>
        </div>
        <label class="switch" aria-label="撒撒娇">
          <input v-model="settings.bubbles.coquetry" type="checkbox" />
          <span class="switch-track"></span>
        </label>
      </div>
      <div class="peek-row">
        <div class="peek-copy">
          <span class="peek-label">闲置喊话</span>
          <span class="peek-hint">5 分钟没人理，岛会喊你回来</span>
        </div>
        <label class="switch" aria-label="闲置喊话">
          <input v-model="settings.bubbles.idleCall" type="checkbox" />
          <span class="switch-track"></span>
        </label>
      </div>
      <div class="peek-row">
        <div class="peek-copy">
          <span class="peek-label">哄哄我</span>
          <span class="peek-hint">跳过或放弃一轮时，安慰一句</span>
        </div>
        <label class="switch" aria-label="哄哄我">
          <input v-model="settings.bubbles.comfort" type="checkbox" />
          <span class="switch-track"></span>
        </label>
      </div>
      <button type="button" class="reset-pos-btn bubble-test" @click="tryBubble">
        吐一个试试
      </button>
    </template>
  </div>

  <div class="settings-section">
    <div class="section-title">岛的样子</div>
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
      <span class="opacity-value">{{ opacityPercent(settings.islandOpacity) }}</span>
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
      <span class="opacity-value">{{ Math.round(settings.islandScale * 100) }}%</span>
    </div>
    <div class="slider-row">
      <label class="slider-label">位置</label>
      <button type="button" class="reset-pos-btn" @click="resetIslandPosition">
        拖乱了？回到默认位置
      </button>
    </div>
  </div>

  <div class="settings-section">
    <div class="section-title">挑个颜色</div>
    <div class="theme-grid">
      <button
        v-for="theme in presetThemes"
        :key="theme.id"
        class="theme-card"
        :class="{ active: settings.activeThemeId === theme.id, locked: isThemeLocked(theme) }"
        :disabled="isThemeLocked(theme)"
        :title="isThemeLocked(theme) ? '完成本周番茄目标就能解锁' : theme.name"
        @click="settings.activeThemeId = theme.id"
      >
        <div class="theme-colors">
          <span class="color-dot" :style="{ background: theme.focusColor }"></span>
          <span class="color-dot" :style="{ background: theme.breakColor }"></span>
          <span class="color-dot" :style="{ background: theme.idleColor }"></span>
        </div>
        <span class="theme-name">{{ theme.name }}</span>
        <span v-if="isThemeLocked(theme)" class="theme-lock">🔒</span>
        <span v-else-if="settings.activeThemeId === theme.id" class="theme-check">✓</span>
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
  margin-top: 10px;
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

.peek-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 10px;
}

.peek-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.peek-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
}

.peek-hint {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  line-height: 1.4;
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

.slider-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.slider-row:last-child {
  margin-bottom: 0;
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

.opacity-value {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  min-width: 32px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.reset-pos-btn {
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

.bubble-tone {
  margin-top: 10px;
}

.bubble-test {
  display: block;
  margin: 10px auto 0;
}

.reset-pos-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  border-color: rgba(255, 255, 255, 0.3);
}

.theme-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.theme-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 8px 4px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;
}

.theme-card:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.12);
}

.theme-card.active {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.25);
}

.theme-card.locked {
  opacity: 0.45;
  cursor: default;
}

.theme-colors {
  display: flex;
  gap: 3px;
}

.color-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

.theme-name {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.75);
  line-height: 1.2;
  white-space: nowrap;
}

.theme-check {
  position: absolute;
  top: 2px;
  right: 4px;
  font-size: 10px;
  color: var(--focus-color);
  font-weight: 700;
}

.theme-lock {
  position: absolute;
  top: 2px;
  right: 4px;
  font-size: 9px;
}
</style>
