<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSettings } from '../composables/useSettings'
import { emitIslandBubble } from '../bubble/bubbleTexts'
import AppSwitch from './AppSwitch.vue'
import type { BubbleTone } from '../utils/settingsMigration'

const { settings } = useSettings()

const toneOptions: Array<{ id: BubbleTone; label: string; hint: string }> = [
  { id: 'quiet', label: '安静', hint: '半小时上下一句' },
  { id: 'normal', label: '正常', hint: '十来分钟一句' },
  { id: 'lively', label: '勤快', hint: '五分钟上下一句' },
]

// 内容开关低频，默认收起只报状态
const contentOpen = ref(false)
const contentSummary = computed(() =>
  [
    settings.value.bubbles.coquetry ? '撒娇开' : '撒娇关',
    settings.value.bubbles.idleCall ? '闲置喊话开' : '闲置喊话关',
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

    <AppSwitch
      v-model="settings.bubbles.enabled"
      label="让未晚随口说话"
      hint="岛会冒小泡泡飘过屏幕，点一下进面板"
    />

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
        <button type="button" class="section-toggle" @click="contentOpen = !contentOpen">
          {{ contentOpen ? '收起' : '内容开关' }}
        </button>
        <span v-if="!contentOpen" class="section-summary">{{ contentSummary }}</span>
      </div>
      <template v-if="contentOpen">
        <AppSwitch
          v-model="settings.bubbles.coquetry"
          label="撒娇"
          hint="时不时冒一句悄悄话"
        />
        <AppSwitch
          v-model="settings.bubbles.idleCall"
          label="闲置喊话"
          hint="5 分钟没有操作时喊你回来"
        />
        <AppSwitch
          v-model="settings.bubbles.comfort"
          label="哄人"
          hint="跳过或放弃一轮时安慰一句"
        />
      </template>
    </template>
  </div>
</template>

<style scoped>
@reference "../styles.css";

.mode-toggle {
  margin-top: 10px;
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
</style>
