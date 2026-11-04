<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSettings } from '../composables/useSettings'

const { settings, autostartError } = useSettings()

// 低频开关默认收起，常用项留在外面
const advancedOpen = ref(false)

const advancedSummary = computed(() =>
  [
    settings.value.notifications.sound ? '提示音开' : '提示音关',
    settings.value.autoLaunch ? '自启开' : '自启关',
  ].join(' · '),
)
</script>

<template>
  <div class="settings-section">
    <div class="section-title-row">
      <div class="section-title">日常小设置</div>
      <button class="section-toggle" @click="advancedOpen = !advancedOpen">
        {{ advancedOpen ? '收起' : '更多开关' }}
      </button>
    </div>
    <p v-if="!advancedOpen" class="section-summary">{{ advancedSummary }}</p>
    <div v-if="advancedOpen" class="update-toggle-row">
      <div class="update-copy">
        <span class="update-label">结束提示音</span>
        <span class="update-hint">每颗番茄结束都会叮一下呀</span>
      </div>
      <label class="switch" aria-label="结束提示音">
        <input v-model="settings.notifications.sound" type="checkbox" />
        <span class="switch-track"></span>
      </label>
    </div>
    <div v-if="advancedOpen" class="update-toggle-row" style="margin-top: 8px;">
      <div class="update-copy">
        <span class="update-label">开机就来陪你</span>
        <span class="update-hint">开机自动出现，不用你找我啦</span>
        <span v-if="autostartError" class="update-hint is-error">{{ autostartError }}</span>
      </div>
      <label class="switch" aria-label="开机就来陪你">
        <input v-model="settings.autoLaunch" type="checkbox" />
        <span class="switch-track"></span>
      </label>
    </div>
  </div>

  <div class="settings-section">
    <div class="section-title">专注和休息</div>
    <div class="duration-grid">
      <div class="duration-cell">
        <label class="duration-label">专注</label>
        <div class="stepper">
          <button class="stepper-btn" @click="settings.focusDuration = Math.max(5, Math.floor((settings.focusDuration - 1) / 5) * 5)">−</button>
          <span class="stepper-value">{{ settings.focusDuration }}</span>
          <button class="stepper-btn" @click="settings.focusDuration = Math.min(120, Math.ceil((settings.focusDuration + 1) / 5) * 5)">+</button>
        </div>
        <span class="duration-unit">分</span>
      </div>
      <div class="duration-cell">
        <label class="duration-label">休息</label>
        <div class="stepper">
          <button class="stepper-btn" @click="settings.breakDuration = Math.max(1, settings.breakDuration - 1)">−</button>
          <span class="stepper-value">{{ settings.breakDuration }}</span>
          <button class="stepper-btn" @click="settings.breakDuration = Math.min(30, settings.breakDuration + 1)">+</button>
        </div>
        <span class="duration-unit">分</span>
      </div>
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

.section-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-title-row .section-title {
  margin-bottom: 0;
}

.section-toggle {
  background: none;
  border: none;
  padding: 2px 0;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.45);
  cursor: pointer;
  font-family: inherit;
}

.section-toggle:hover {
  color: rgba(255, 255, 255, 0.75);
}

.section-summary {
  margin: 4px 0 0;
  font-size: 10px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.35);
}

.update-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.update-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.update-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.78);
}

.update-hint {
  font-size: 10px;
  line-height: 1.4;
  color: rgba(255, 255, 255, 0.36);
}

.update-hint.is-error {
  color: #f87171;
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

.switch input:focus-visible + .switch-track {
  outline: 2px solid color-mix(in srgb, var(--focus-color) 80%, white);
  outline-offset: 2px;
}

.duration-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.duration-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.duration-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  flex-shrink: 0;
}

.stepper {
  display: flex;
  align-items: center;
  gap: 0;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  overflow: hidden;
}

.stepper-btn {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.7);
  font-size: 14px;
  width: 24px;
  height: 24px;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.stepper-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.stepper-value {
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  min-width: 26px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.duration-unit {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
}
</style>
