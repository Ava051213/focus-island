<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSettings } from '../composables/useSettings'
import { emitIslandBubble } from '../utils/bubbleTexts'
import type { BubbleTone } from '../utils/settingsMigration'

const { settings } = useSettings()

const toneOptions: Array<{ id: BubbleTone; label: string; hint: string }> = [
  { id: 'quiet', label: '安静', hint: '半小时上下冒一句' },
  { id: 'normal', label: '正常', hint: '十来分钟一句' },
  { id: 'lively', label: '勤快', hint: '五分钟上下一句，很黏人' },
]

// 内容开关低频，默认收起只报状态
const contentOpen = ref(false)
const contentSummary = computed(() =>
  [
    settings.value.bubbles.coquetry ? '撒娇开' : '撒娇关',
    settings.value.bubbles.idleCall ? '喊话开' : '喊话关',
    settings.value.bubbles.comfort ? '哄人开' : '哄人关',
  ].join(' · '),
)

// 让 overlay 直接吐一个泡泡，验收用
function tryBubble() {
  emitIslandBubble('test')
}
</script>

<template>
  <div class="settings-section">
    <div class="section-title">泡泡</div>

    <div class="toggle-row">
      <div class="toggle-copy">
        <span class="toggle-label">让未晚随口说话</span>
        <span class="toggle-hint">岛会冒小泡泡飘过屏幕，点一下进面板</span>
      </div>
      <label class="switch" aria-label="吐泡泡">
        <input v-model="settings.bubbles.enabled" type="checkbox" />
        <span class="switch-track"></span>
      </label>
    </div>

    <template v-if="settings.bubbles.enabled">
      <div class="mode-toggle" role="group" aria-label="泡泡密度">
        <button
          v-for="t in toneOptions"
          :key="t.id"
          type="button"
          class="mode-btn"
          :class="{ active: settings.bubbles.tone === t.id }"
          :title="t.hint"
          @click="settings.bubbles.tone = t.id"
        >
          {{ t.label }}
        </button>
      </div>

      <button type="button" class="ghost-btn try-btn" @click="tryBubble">
        吐一个试试
      </button>

      <div class="fold-row">
        <button type="button" class="fold-toggle" @click="contentOpen = !contentOpen">
          {{ contentOpen ? '收起' : '内容开关' }}
        </button>
        <span v-if="!contentOpen" class="fold-summary">{{ contentSummary }}</span>
      </div>
      <template v-if="contentOpen">
        <div class="toggle-row">
          <div class="toggle-copy">
            <span class="toggle-label">撒撒娇</span>
            <span class="toggle-hint">时不时冒一句娇气的悄悄话</span>
          </div>
          <label class="switch" aria-label="撒撒娇">
            <input v-model="settings.bubbles.coquetry" type="checkbox" />
            <span class="switch-track"></span>
          </label>
        </div>
        <div class="toggle-row">
          <div class="toggle-copy">
            <span class="toggle-label">闲置喊话</span>
            <span class="toggle-hint">5 分钟没人理，岛会喊你回来</span>
          </div>
          <label class="switch" aria-label="闲置喊话">
            <input v-model="settings.bubbles.idleCall" type="checkbox" />
            <span class="switch-track"></span>
          </label>
        </div>
        <div class="toggle-row">
          <div class="toggle-copy">
            <span class="toggle-label">哄哄我</span>
            <span class="toggle-hint">跳过或放弃一轮时，安慰一句</span>
          </div>
          <label class="switch" aria-label="哄哄我">
            <input v-model="settings.bubbles.comfort" type="checkbox" />
            <span class="switch-track"></span>
          </label>
        </div>
      </template>
    </template>
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

.mode-toggle {
  display: flex;
  align-items: center;
  margin-top: 10px;
  border: 1px solid color-mix(in srgb, var(--focus-color) 82%, transparent);
  border-radius: 999px;
  overflow: hidden;
  width: fit-content;
  max-width: 100%;
}

.mode-btn {
  appearance: none;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.85);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  height: 28px;
  padding: 0 14px;
  cursor: pointer;
  transition: background 0.22s ease, color 0.22s ease;
  white-space: nowrap;
}

.mode-btn + .mode-btn {
  border-left: 1px solid color-mix(in srgb, var(--focus-color) 58%, transparent);
}

.mode-btn:hover {
  background: color-mix(in srgb, var(--focus-color) 15%, transparent);
}

.mode-btn.active {
  background: var(--focus-color);
  color: #fff;
}

.ghost-btn {
  appearance: none;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 999px;
  background: transparent;
  color: rgba(255, 255, 255, 0.75);
  font-size: 11px;
  line-height: 1;
  height: 24px;
  padding: 0 10px;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
}

.ghost-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  border-color: rgba(255, 255, 255, 0.3);
}

.try-btn {
  display: block;
  margin: 10px auto 0;
}

.fold-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
}

.fold-toggle {
  appearance: none;
  border: none;
  background: transparent;
  padding: 0;
  font-size: 11px;
  color: var(--focus-color);
  cursor: pointer;
  font-family: inherit;
}

.fold-summary {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.36);
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
