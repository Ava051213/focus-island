<script setup lang="ts">
import { ref, onMounted, onUnmounted, onActivated, onDeactivated } from 'vue'
import { useSettings } from '../composables/useSettings'

const { settings } = useSettings()

const isRecording = ref(false)

function formatShortcut(key: string): string {
  if (!key) return '无'
  return key.replace('CommandOrControl', navigator.userAgent.includes('Mac') ? '⌘' : 'Ctrl')
    .replace('Alt', 'Alt')
    .replace('Shift', '⇧')
    .replace('Control', 'Ctrl')
}

function startRecording() {
  isRecording.value = true
}

function stopRecording() {
  isRecording.value = false
}

let recordedKey = ''

function buildCombo(e: KeyboardEvent): string {
  const mods: string[] = []
  if (e.ctrlKey) mods.push('Control')
  if (e.altKey) mods.push('Alt')
  if (e.metaKey) mods.push('CommandOrControl')
  if (e.shiftKey) mods.push('Shift')

  const code = e.code
  let keyName: string
  if (code.startsWith('Key')) keyName = code.slice(3)
  else if (code.startsWith('Digit')) keyName = code.slice(5)
  else keyName = code

  return mods.join('+') + '+' + keyName
}

function onRecordKeydown(e: KeyboardEvent) {
  if (!isRecording.value) return
  // Skip modifier-only presses
  if (e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta' || e.key === 'Shift') return
  // Skip if no modifier is held
  if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) return

  e.preventDefault()
  e.stopPropagation()
  recordedKey = buildCombo(e)
}

function onRecordKeyup(e: KeyboardEvent) {
  if (!isRecording.value) return

  // Fallback: if keydown was intercepted (e.g. Option+Space on macOS),
  // capture the combo from keyup instead
  if (!recordedKey && (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey)) {
    if (e.key !== 'Control' && e.key !== 'Alt' && e.key !== 'Meta' && e.key !== 'Shift') {
      recordedKey = buildCombo(e)
    }
  }

  // Finalize when all modifiers are released
  if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
    if (recordedKey) {
      settings.value.shortcutKey = recordedKey
      recordedKey = ''
      isRecording.value = false
    } else {
      // Released all mods without hitting a key — cancel
      isRecording.value = false
    }
  }
}

function resetRecording() {
  stopRecording()
  recordedKey = ''
}

let recordListenersBound = false

function bindRecordListeners() {
  if (recordListenersBound) return
  document.addEventListener('keydown', onRecordKeydown, true)
  document.addEventListener('keyup', onRecordKeyup, true)
  recordListenersBound = true
}

function unbindRecordListeners() {
  if (!recordListenersBound) return
  document.removeEventListener('keydown', onRecordKeydown, true)
  document.removeEventListener('keyup', onRecordKeyup, true)
  recordListenersBound = false
}

onMounted(() => {
  bindRecordListeners()
})

onActivated(() => {
  bindRecordListeners()
})

onDeactivated(() => {
  resetRecording()
  unbindRecordListeners()
})

onUnmounted(() => {
  unbindRecordListeners()
})

defineExpose({ resetRecording })
</script>

<template>
  <div class="settings-section">
    <div class="section-title">日常小设置</div>
    <div class="update-toggle-row">
      <div class="update-copy">
        <span class="update-label">结束提示音</span>
        <span class="update-hint">每颗番茄结束都会叮一下呀</span>
      </div>
      <label class="switch" aria-label="结束提示音">
        <input v-model="settings.notificationSound" type="checkbox" />
        <span class="switch-track"></span>
      </label>
    </div>
    <div class="update-toggle-row" style="margin-top: 8px;">
      <div class="update-copy">
        <span class="update-label">全屏时自动避让</span>
        <span class="update-hint">看视频、打游戏、演示时先躲起来，番茄结束再冒出来提醒</span>
      </div>
      <label class="switch" aria-label="全屏时自动避让">
        <input v-model="settings.hideOnFullscreen" type="checkbox" />
        <span class="switch-track"></span>
      </label>
    </div>
    <div class="update-toggle-row" style="margin-top: 8px;">
      <div class="update-copy">
        <span class="update-label">开机就来陪你</span>
        <span class="update-hint">开机自动出现，不用你找我啦</span>
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

  <div class="settings-section">
    <div class="section-title">顺手一点</div>
    <div class="shortcut-row">
      <span class="shortcut-label">叫出我</span>
      <button
        class="shortcut-recorder"
        :class="{ recording: isRecording }"
        @click="startRecording"
        tabindex="0"
      >
        <span v-if="isRecording" class="recording-hint">按一个组合键嘛…</span>
        <span v-else>{{ formatShortcut(settings.shortcutKey) }}</span>
      </button>
      <span class="shortcut-hint" v-if="!isRecording">推荐 Ctrl+P 或 Alt+Space，按 Esc 就把我收起来～</span>
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

.shortcut-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}

.shortcut-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
}

.shortcut-recorder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 120px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.85);
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s;
}

.shortcut-recorder:hover {
  background: rgba(255, 255, 255, 0.10);
  border-color: rgba(255, 255, 255, 0.25);
}

.shortcut-recorder.recording {
  border-color: var(--focus-color);
  background: color-mix(in srgb, var(--focus-color) 15%, transparent);
  box-shadow: 0 0 0 1px var(--focus-color);
  animation: recorder-pulse 1.2s ease-in-out infinite;
}

@keyframes recorder-pulse {
  0%, 100% { box-shadow: 0 0 0 1px var(--focus-color); }
  50% { box-shadow: 0 0 0 2px var(--focus-color), 0 0 8px color-mix(in srgb, var(--focus-color) 40%, transparent); }
}

.recording-hint {
  color: var(--focus-color);
  font-weight: 500;
}

.shortcut-hint {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.35);
  white-space: nowrap;
}
</style>
