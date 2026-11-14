<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSettings } from '../composables/useSettings'
import { useAi } from '../composables/useAi'
import AppSwitch from './AppSwitch.vue'

const { settings } = useSettings()
const { testProvider } = useAi()

// 低频配置默认收起，只留一行状态
const aiOpen = ref(false)

const aiSummary = computed(() =>
  [
    settings.value.aiSiliconKey ? '硅基流动已配' : '硅基流动未配',
    settings.value.aiApiKey ? '智谱已配' : '智谱未配',
    settings.value.aiAutoEnabled ? '自动建议开' : '自动建议关',
  ].join(' · '),
)

const testingProvider = ref<'' | 'silicon' | 'zhipu'>('')
const testMessages = ref<{ silicon: string; zhipu: string }>({ silicon: '', zhipu: '' })

async function runAiTest(id: 'silicon' | 'zhipu') {
  if (testingProvider.value) return
  testingProvider.value = id
  testMessages.value = { ...testMessages.value, [id]: '' }
  const result = await testProvider(id)
  testMessages.value = {
    ...testMessages.value,
    [id]: result.ok ? `已连接，用时 ${(result.ms / 1000).toFixed(1)} 秒` : result.message,
  }
  testingProvider.value = ''
}
</script>

<template>
  <div class="settings-section">
    <div class="section-title-row">
      <div class="section-title">未晚</div>
      <button class="section-toggle" @click="aiOpen = !aiOpen">
        {{ aiOpen ? '收起' : '更多设置' }}
      </button>
    </div>
    <p v-if="!aiOpen" class="section-summary">{{ aiSummary }}</p>

    <div v-if="aiOpen">
      <div class="section-subtitle">硅基流动</div>
      <div class="ai-field">
        <span class="ai-label">API Key</span>
        <input
          v-model="settings.aiSiliconKey"
          class="ai-input"
          type="password"
          placeholder="硅基流动 API Key"
          autocomplete="off"
          spellcheck="false"
        />
        <button
          class="ai-test-btn"
          :disabled="testingProvider === 'silicon'"
          @click="runAiTest('silicon')"
        >
          {{ testingProvider === 'silicon' ? '测试中' : '测试' }}
        </button>
      </div>
      <div class="ai-field">
        <span class="ai-label">模型</span>
        <input
          v-model="settings.aiSiliconModel"
          class="ai-input"
          type="text"
          placeholder="Qwen/Qwen3-8B"
          spellcheck="false"
        />
      </div>
      <p v-if="testMessages.silicon" class="ai-test-result">{{ testMessages.silicon }}</p>

      <div class="section-subtitle">智谱</div>
      <div class="ai-field">
        <span class="ai-label">API Key</span>
        <input
          v-model="settings.aiApiKey"
          class="ai-input"
          type="password"
          placeholder="智谱开放平台 API Key"
          autocomplete="off"
          spellcheck="false"
        />
        <button
          class="ai-test-btn"
          :disabled="testingProvider === 'zhipu'"
          @click="runAiTest('zhipu')"
        >
          {{ testingProvider === 'zhipu' ? '测试中' : '测试' }}
        </button>
      </div>
      <div class="ai-field">
        <span class="ai-label">模型</span>
        <input
          v-model="settings.aiModel"
          class="ai-input"
          type="text"
          placeholder="glm-4.7-flash"
          spellcheck="false"
        />
      </div>
      <p v-if="testMessages.zhipu" class="ai-test-result">{{ testMessages.zhipu }}</p>

      <AppSwitch
        v-model="settings.aiAutoEnabled"
        label="自动生成建议"
        hint="小记或日程有变化时自动想一想，十分钟最多一次"
      />
    </div>
  </div>
</template>

<style scoped>
@reference "../styles.css";

.section-subtitle {
  margin-top: 10px;
}

.ai-field {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.ai-label {
  flex-shrink: 0;
  width: 56px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
}

.ai-input {
  flex: 1;
  min-width: 0;
  height: 30px;
  padding: 0 9px;
  font-size: 12px;
  font-family: inherit;
  color: #fff;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: var(--radius-md);
  outline: none;
}

.ai-input:focus {
  border-color: var(--accent-soft);
}

.ai-test-btn {
  flex-shrink: 0;
  height: 30px;
  padding: 0 10px;
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--border-soft);
  color: rgba(255, 255, 255, 0.6);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
}

.ai-test-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.ai-test-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.ai-test-result {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--accent-soft);
}
</style>
