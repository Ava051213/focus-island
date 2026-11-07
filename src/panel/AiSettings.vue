<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSettings } from '../composables/useSettings'
import { useAi } from '../composables/useAi'

const { settings } = useSettings()
const { testProvider } = useAi()

// 和「日常小设置」一样，低频配置默认收起，只留一行状态
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
    [id]: result.ok ? `连上啦，用了 ${(result.ms / 1000).toFixed(1)} 秒` : result.message,
  }
  testingProvider.value = ''
}
</script>

<template>
  <div class="settings-section">
    <div class="section-title-row">
      <div class="section-title">青梅</div>
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
        {{ testingProvider === 'silicon' ? '测着呢' : '测一下' }}
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
        {{ testingProvider === 'zhipu' ? '测着呢' : '测一下' }}
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

    <div class="update-toggle-row" style="margin-top: 10px;">
      <div class="update-copy">
        <span class="update-label">自己悄悄想建议</span>
        <span class="update-hint">小记或日程有变化，我就自己想一想，十分钟最多一次喔</span>
      </div>
      <label class="switch" aria-label="自己悄悄想建议">
        <input v-model="settings.aiAutoEnabled" type="checkbox" />
        <span class="switch-track"></span>
      </label>
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

.section-subtitle {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  font-weight: 500;
  letter-spacing: 0.5px;
  margin-top: 10px;
  margin-bottom: 6px;
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
  border-radius: 8px;
  outline: none;
}

.ai-input:focus {
  border-color: color-mix(in srgb, var(--focus-color) 55%, transparent);
}

.ai-test-btn {
  flex-shrink: 0;
  height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
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
  color: color-mix(in srgb, var(--focus-color) 75%, rgba(255, 255, 255, 0.5));
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
</style>
