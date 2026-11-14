<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useSettings } from '../composables/useSettings'
import { shortcutError } from '../composables/useShortcut'
import {
  permissionState,
  refreshNotificationPermission,
} from '../composables/useSystemNotify'
import AppSwitch from './AppSwitch.vue'
import ShortcutRecorder from './ShortcutRecorder.vue'

const { settings, autostartError } = useSettings()

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
    <div class="section-title">快捷键</div>

    <AppSwitch
      v-model="settings.shortcuts.enabled"
      label="启用全局快捷键"
      hint="在任何应用里都能开始 / 暂停计时"
    />

    <div class="shortcut-row">
      <span class="shortcut-label">开始 / 暂停</span>
      <ShortcutRecorder
        v-model="settings.shortcuts.toggleTimer"
        :disabled="!settings.shortcuts.enabled"
      />
    </div>

    <div class="shortcut-row">
      <span class="shortcut-label">快速记一条</span>
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

    <p v-if="shortcutError" class="error-text">{{ shortcutError }}</p>
    <p v-else class="section-note">组合键冲突时这里会提示，应用仍可正常使用。</p>
  </div>

  <div class="settings-section">
    <div class="section-title">托盘与启动</div>
    <AppSwitch
      v-model="settings.tray.closeToTray"
      label="关闭窗口时隐藏到托盘"
      hint="关闭后按 Alt+F4 会直接退出；左键单击托盘图标切换灵动岛"
    />
    <AppSwitch
      v-model="settings.autoLaunch"
      label="开机自动启动"
      hint="开机自动出现"
      :error="autostartError ?? undefined"
    />
  </div>

  <div class="settings-section">
    <div class="section-title">系统通知</div>

    <AppSwitch
      v-model="settings.notifications.enabled"
      label="阶段结束发系统通知"
      hint="专注或休息结束时弹一条系统通知"
    />

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
  color: var(--color-ok);
}

.permission-value.denied {
  color: var(--color-danger);
}
</style>
