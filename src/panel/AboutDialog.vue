<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { open } from '@tauri-apps/plugin-shell'
import { getName } from '@tauri-apps/api/app'
import { useUpdateCheck } from '../composables/useUpdateCheck'

const emit = defineEmits<{ close: [] }>()

const appName = ref('专注岛')

const { currentVersion, latest, checking, checkedAt, error, hasUpdate, hint, check, releaseUrl } = useUpdateCheck()

const githubUrl = 'https://github.com/Ava051213/focus-island'
import appIcon from '../../src-tauri/icons/128x128.png'

onMounted(async () => {
  try {
    appName.value = await getName()
  } catch {
    appName.value = '专注岛'
  }
  // 还没查过就顺手查一次；查过就直接用启动时那次的结果，不重复打网络
  if (checkedAt.value === null) void check({ silent: true })
})

function openGitHub() {
  open(githubUrl)
}

function openLatest() {
  open(releaseUrl.value)
}

function onBackdropClick(event: MouseEvent) {
  if (event.target === event.currentTarget) {
    emit('close')
  }
}
</script>

<template>
  <div class="dialog-backdrop" @click="onBackdropClick">
    <div class="dialog-container" @click.stop>
      <!-- 应用图标 -->
      <div class="app-icon-wrapper">
        <img :src="appIcon" :alt="appName" class="app-icon" />
      </div>

      <!-- 应用名称和版本 -->
      <div class="app-info">
        <h2 class="app-name">{{ appName }}</h2>
        <span class="app-version">v{{ currentVersion || '—' }}</span>
      </div>

      <!-- GitHub 链接 -->
      <button class="link-btn" @click="openGitHub">
        <svg class="icon" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
        </svg>
        <span>GitHub</span>
      </button>

      <!-- 更新检查 -->
      <div class="update-block">
        <button v-if="hasUpdate" class="update-link" @click="openLatest">
          发现新版本 v{{ latest?.version }}，前往下载
        </button>
        <span v-else-if="error" class="update-hint">{{ error }}</span>
        <span v-else-if="hint" class="update-hint">{{ hint }}</span>
        <button class="link-btn update-check" :disabled="checking" @click="check()">
          {{ checking ? '检查中…' : '检查更新' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "../styles.css";

.dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fade-in 0.2s ease-out;
}

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.dialog-container {
  width: 260px;
  padding: 28px 24px;
  background: linear-gradient(180deg, rgba(28, 28, 32, 0.98), rgba(22, 22, 26, 0.97));
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  animation: scale-in 0.25s cubic-bezier(0.2, 0.8, 0.22, 1);
}

@keyframes scale-in {
  from {
    opacity: 0;
    transform: scale(0.9);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.app-icon-wrapper {
  width: 72px;
  height: 72px;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}

.app-icon {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.app-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.app-name {
  font-size: 18px;
  font-weight: 600;
  color: #fff;
  margin: 0;
}

.app-version {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
}

.link-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 16px;
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  cursor: pointer;
  transition: color 0.2s;
}

.link-btn:hover {
  color: var(--focus-color);
}

.link-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.link-btn .icon {
  width: 16px;
  height: 16px;
}

.update-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin-top: -4px;
}

.update-hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
}

.update-link {
  background: transparent;
  border: none;
  padding: 0;
  font-size: 12px;
  color: var(--focus-color);
  cursor: pointer;
}

.update-link:hover {
  opacity: 0.8;
}

.update-check {
  padding: 2px 8px;
  font-size: 12px;
}
</style>
