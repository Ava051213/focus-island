<script setup lang="ts">
import { useSettings, presetThemes, type ColorMode } from '../composables/useSettings'
import { useRewardUnlocks } from '../composables/useWeeklyGoals'

const { settings } = useSettings()
const { unlockedRewards } = useRewardUnlocks()

function isThemeLocked(theme: (typeof presetThemes)[number]): boolean {
  return !!theme.rewardId && !unlockedRewards.value.some(id => id === theme.rewardId)
}

const colorModeOptions: Array<{ id: ColorMode; label: string }> = [
  { id: 'dark', label: '暗暗的' },
  { id: 'light', label: '亮亮的' },
  { id: 'system', label: '跟着系统' },
]

function switchColorMode(mode: ColorMode) {
  if (settings.value.colorMode === mode) return
  settings.value.colorMode = mode
}
</script>

<template>
  <div class="settings-section">
    <div class="section-title">外观</div>
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

.theme-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin-top: 10px;
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
