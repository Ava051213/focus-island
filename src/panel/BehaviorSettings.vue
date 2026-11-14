<script setup lang="ts">
import { useSettings } from '../composables/useSettings'

const { settings } = useSettings()
</script>

<template>
  <div class="settings-section">
    <div class="section-title">专注与休息</div>
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
    <div class="toggle-row">
      <div class="toggle-copy">
        <span class="toggle-label">结束提示音</span>
        <span class="toggle-hint">每颗番茄结束都会叮一下呀</span>
      </div>
      <label class="switch" aria-label="结束提示音">
        <input v-model="settings.notifications.sound" type="checkbox" />
        <span class="switch-track"></span>
      </label>
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

.duration-grid {
  display: flex;
  gap: 12px;
}

.duration-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  padding: 10px 12px;
}

.duration-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
}

.stepper {
  display: flex;
  align-items: center;
  gap: 8px;
}

.stepper-btn {
  appearance: none;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.8);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}

.stepper-btn:hover {
  background: rgba(255, 255, 255, 0.14);
}

.stepper-value {
  font-size: 15px;
  font-weight: 600;
  color: #fff;
  min-width: 24px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.duration-unit {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
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
