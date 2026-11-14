<script setup lang="ts">
import { useSettings, presetThemes, CUSTOM_THEME_ID, type ColorMode } from '../composables/useSettings'
import { useRewardUnlocks } from '../composables/useWeeklyGoals'

const { settings } = useSettings()
const { unlockedRewards } = useRewardUnlocks()

const colorModeOptions: Array<{ id: ColorMode; label: string }> = [
  { id: 'dark', label: '深色' },
  { id: 'light', label: '浅色' },
  { id: 'system', label: '跟随系统' },
]

function switchColorMode(mode: ColorMode) {
  if (settings.value.colorMode === mode) return
  settings.value.colorMode = mode
}

function isThemeLocked(theme: (typeof presetThemes)[number]): boolean {
  return !!theme.rewardId && !unlockedRewards.value.some(id => id === theme.rewardId)
}

function pickTheme(id: string, locked?: boolean) {
  if (locked) return
  settings.value.activeThemeId = id
}

// 自定义取色：选色即启用自定义主题
function pickCustomColor(e: Event) {
  const value = (e.target as HTMLInputElement).value
  settings.value.customFocusColor = value
  settings.value.activeThemeId = CUSTOM_THEME_ID
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
        :title="isThemeLocked(theme) ? '完成本周目标后解锁' : theme.name"
        @click="pickTheme(theme.id, isThemeLocked(theme))"
      >
        <span class="theme-strip">
          <i :style="{ background: theme.focusColor }"></i>
          <i :style="{ background: theme.breakColor }"></i>
          <i :style="{ background: theme.idleColor }"></i>
        </span>
        <span class="theme-name">{{ theme.name }}</span>
        <span v-if="isThemeLocked(theme)" class="theme-flag">未解锁</span>
        <span v-else-if="settings.activeThemeId === theme.id" class="theme-flag check">✓</span>
      </button>

      <button
        class="theme-card custom"
        :class="{ active: settings.activeThemeId === CUSTOM_THEME_ID }"
        @click="settings.activeThemeId = CUSTOM_THEME_ID"
      >
        <span class="theme-strip">
          <i :style="{ background: settings.customFocusColor || '#888888' }"></i>
          <i class="strip-dim"></i>
          <i class="strip-dim"></i>
        </span>
        <span class="theme-name">自定义</span>
        <span
          v-if="settings.activeThemeId === CUSTOM_THEME_ID"
          class="theme-flag check"
        >✓</span>
        <input
          type="color"
          class="color-input"
          :value="settings.customFocusColor || '#f0682e'"
          title="选一个主色"
          @click.stop
          @input="pickCustomColor"
        />
      </button>
    </div>
  </div>
</template>

<style scoped>
@reference "../styles.css";

.mode-toggle {
  display: flex;
  align-items: center;
  border: 1px solid var(--accent-strong);
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
  border-left: 1px solid var(--accent-soft);
}

.mode-btn:hover {
  background: var(--accent-weak);
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
  gap: 6px;
  padding: 10px 4px 8px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-faint);
  background: var(--surface-card);
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

/* 主题色的三段预览条 */
.theme-strip {
  display: flex;
  width: 100%;
  height: 8px;
  border-radius: 999px;
  overflow: hidden;
}

.theme-strip i {
  flex: 1;
}

.theme-strip i.strip-dim {
  background: rgba(255, 255, 255, 0.12);
}

.theme-name {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.75);
  line-height: 1.2;
  white-space: nowrap;
}

.theme-flag {
  position: absolute;
  top: 3px;
  right: 5px;
  font-size: 9px;
  color: rgba(255, 255, 255, 0.4);
}

.theme-flag.check {
  color: var(--focus-color);
  font-weight: 700;
}

/* 原生取色器：铺满卡片但完全透明，点卡片即弹取色 */
.color-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  border: none;
  padding: 0;
}
</style>
