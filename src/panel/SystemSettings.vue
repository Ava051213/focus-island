<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useSettings } from '../composables/useSettings'
import { shortcutError } from '../composables/useShortcut'
import {
  permissionState,
  refreshNotificationPermission,
} from '../composables/useSystemNotify'
import ShortcutRecorder from './ShortcutRecorder.vue'

const { settings } = useSettings()

const permissionText = computed(() => {
  switch (permissionState.value) {
    case 'granted': return '已允许'
    case 'denied': return '未授权'
    case 'unavailable': return '仅桌面版可用'
    default: return '未知'
  }
})

function clearShowWindow() {
  settings.value.shortcuts.showWindow = ''
}

onMounted(() => {
  void refreshNotificationPermission()
})

// 重新打开通知开关时刷新一次权限状态，不主动反复申请
watch(
  () => settings.value.notifications.enabled,
  (enabled) => {
    if (enabled) void refreshNotificationPermission()
  },
)
</script>

<template>
  <div class="settings-section">
    <div class="section-title">全局快捷键</div>

    <div class="update-toggle-row">
      <div class="update-copy">
        <span class="update-label">启用全局快捷键</span>
        <span class="update-hint">在任何应用里都能开始 / 暂停计时</span>
      </div>
      <label class="switch" aria-label="启用全局快捷键">
        <input v-model="settings.shortcuts.enabled" type="checkbox" />
        <span class="switch-track"></span>
      </label>
    </div>

    <div class="shortcut-row">
      <span class="shortcut-label">开始 / 暂停</span>
      <ShortcutRecorder
        v-model="settings.shortcuts.toggleTimer"
        :disabled="!settings.shortcuts.enabled"
      />
    </div>

    <div class="shortcut-row">
      <span class="shortcut-label">打开清单</span>
      <ShortcutRecorder
        v-model="settings.shortcuts.showWindow"
        placeholder="未设置"
        :disabled="!settings.shortcuts.enabled"
      />
      <button
        v-if="settings.shortcuts.showWindow"
        class="clear-btn"
        @click="clearShowWindow"
      >
        清除
      </button>
    </div>

    <p v-if="shortcutError" class="shortcut-error">{{ shortcutError }}</p>
    <p v-else class="section-note">组合键冲突时这里会提示，应用仍可正常使用。</p>
  </div>

  <div class="settings-section">
    <div class="section-title">窗口与托盘</div>
    <div class="update-toggle-row">
      <div class="update-copy">
        <span class="update-label">关闭窗口时隐藏到托盘</span>
        <span class="update-hint">关掉后按 Alt+F4 会直接退出；左键单击托盘图标切换灵动岛</span>
      </div>
      <label class="switch" aria-label="关闭窗口时隐藏到托盘">
        <input v-model="settings.tray.closeToTray" type="checkbox" />
        <span class="switch-track"></span>
      </label>
    </div>
  </div>

  <div class="settings-section">
    <div class="section-title">系统通知</div>

    <div class="update-toggle-row">
      <div class="update-copy">
        <span class="update-label">阶段结束发系统通知</span>
        <span class="update-hint">专注或休息结束时弹一条系统通知</span>
      </div>
      <label class="switch" aria-label="阶段结束发系统通知">
        <input v-model="settings.notifications.enabled" type="checkbox" />
        <span class="switch-track"></span>
      </label>
    </div>

    <div class="update-toggle-row spaced">
      <div class="update-copy">
        <span class="update-label">通知声音</span>
        <span class="update-hint">关掉后应用提示音也一起静默</span>
      </div>
      <label class="switch" aria-label="通知声音">
        <input v-model="settings.notifications.sound" type="checkbox" />
        <span class="switch-track"></span>
      </label>
    </div>

    <div class="permission-row">
      <span class="permission-label">系统通知权限</span>
      <span class="permission-value" :class="permissionState">{{ permissionText }}</span>
    </div>
    <p v-if="permissionState === 'denied'" class="section-note">
      需要在系统设置里允许「专注岛」发送通知；这里不会反复弹权限请求。
    </p>
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

.update-toggle-row.spaced {
  margin-top: 8px;
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

.shortcut-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}

.shortcut-label {
  min-width: 62px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
}

.clear-btn {
  background: none;
  border: none;
  padding: 2px 4px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  font-family: inherit;
}

.clear-btn:hover {
  color: var(--focus-color);
}

.shortcut-error {
  margin: 8px 0 0;
  font-size: 10px;
  line-height: 1.5;
  color: #f87171;
}

.section-note {
  margin: 6px 0 0;
  font-size: 10px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.35);
}

.permission-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
  font-size: 11px;
}

.permission-label {
  color: rgba(255, 255, 255, 0.6);
}

.permission-value {
  color: rgba(255, 255, 255, 0.45);
}

.permission-value.granted {
  color: #4ade80;
}

.permission-value.denied {
  color: #f87171;
}
</style>
