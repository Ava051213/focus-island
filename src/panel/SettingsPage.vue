<script setup lang="ts">
import { ref } from 'vue'
import AboutDialog from './AboutDialog.vue'
import AppearanceSettings from './AppearanceSettings.vue'
import BehaviorSettings from './BehaviorSettings.vue'
import SystemSettings from './SystemSettings.vue'
import AiSettings from './AiSettings.vue'
import { useUpdateCheck } from '../composables/useUpdateCheck'

const emit = defineEmits<{ back: [] }>()

const showAbout = ref(false)
const { hasUpdate } = useUpdateCheck()

function goBack() {
  showAbout.value = false
  emit('back')
}
</script>

<template>
  <div class="settings-page" :class="{ 'blurred': showAbout }">
    <div class="settings-header">
      <button class="back-btn" @click="goBack">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
      </button>
      <button class="about-btn" @click="showAbout = true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
        </svg>
        <span v-if="hasUpdate" class="update-dot" title="有新版本"></span>
      </button>
    </div>

    <AppearanceSettings />
    <BehaviorSettings />
    <SystemSettings />
    <AiSettings />
  </div>

  <!-- 关于弹窗 -->
  <AboutDialog v-if="showAbout" @close="showAbout = false" />
</template>

<style scoped>
@reference "../styles.css";

.settings-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  color: #e8e8ea;
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

.back-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.back-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.2);
  color: #fff;
}

.about-btn {
  position: relative;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.update-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #f87171;
}

.about-btn:hover {
  color: var(--focus-color);
}

.settings-page::-webkit-scrollbar { width: 4px; }
.settings-page::-webkit-scrollbar-track { background: transparent; }
.settings-page::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 2px; }

/* 毛玻璃模糊效果 */
.settings-page.blurred {
  filter: blur(8px);
  opacity: 0.7;
  transition: filter 0.2s ease-out, opacity 0.2s ease-out;
}
</style>
