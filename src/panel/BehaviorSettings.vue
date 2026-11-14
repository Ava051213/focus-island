<script setup lang="ts">
import { useSettings } from '../composables/useSettings'
import AppSwitch from './AppSwitch.vue'

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
    <AppSwitch
      v-model="settings.notifications.sound"
      label="结束提示音"
      hint="每颗番茄结束时响一声提示音"
    />
  </div>
</template>

<style scoped>
@reference "../styles.css";

.duration-grid {
  display: flex;
  gap: 12px;
}

.duration-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  background: var(--surface-card);
  border: 1px solid var(--border-faint);
  border-radius: var(--radius-md);
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
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid var(--border-soft);
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
</style>
