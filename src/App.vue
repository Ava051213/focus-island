<script setup lang="ts">
import { ref, onMounted } from 'vue'
import Island from './components/Island.vue'
import PanelApp from './panel/PanelApp.vue'

// 泡泡 overlay 不走这里：它有独立入口 bubble.html（懒创建 + 轻量包）
const windowLabel = ref<string>('main')

onMounted(async () => {
  try {
    const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
    windowLabel.value = getCurrentWebviewWindow().label
  } catch {
    windowLabel.value = 'main'
  }
})
</script>

<template>
  <Island v-if="windowLabel === 'main'" />
  <PanelApp v-else-if="windowLabel === 'panel'" />
</template>
