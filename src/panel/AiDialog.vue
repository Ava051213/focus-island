<script setup lang="ts">
import { computed, ref } from 'vue'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { useAi, type PlanTaskInput } from '../composables/useAi'
import { eventDate, useEvents } from '../composables/useEvents'
import { useDailyStats } from '../composables/useDailyStats'

const props = defineProps<{
  mode: 'breakdown' | 'plan' | 'memo'
  initialText?: string
  memoContent?: string
}>()

const emit = defineEmits<{
  close: []
  addTasks: [payload: { titles: string[]; target: 'today' | 'inbox' }]
  insert: [text: string]
}>()

const { configured, breakdownGoal, suggestToday, summarizeMemo } = useAi()
const { upcoming } = useEvents()
const { todayStat } = useDailyStats()

const titles = {
  breakdown: '陪你拆一拆',
  plan: '今天先做点什么呀',
  memo: '帮你理一理',
} as const

const title = computed(() => titles[props.mode])
const prompt = ref(props.initialText ?? '')
const loading = ref(false)
const error = ref('')
const resultTasks = ref<string[]>([])
const selected = ref<boolean[]>([])
const resultText = ref('')
const memoStyle = ref<'summary' | 'checklist'>('checklist')
const copied = ref(false)

const hasResult = computed(() =>
  props.mode === 'breakdown' ? resultTasks.value.length > 0 : resultText.value.length > 0,
)

const selectedTitles = computed(() =>
  resultTasks.value.filter((_, index) => selected.value[index]),
)

async function generate() {
  if (loading.value) return
  error.value = ''
  loading.value = true
  try {
    if (props.mode === 'breakdown') {
      const goal = prompt.value.trim()
      if (!goal) {
        error.value = '先写一句想做的事嘛，比如「准备下周的组会汇报」'
        return
      }
      const existing = upcoming.value.map(event => event.title)
      const list = await breakdownGoal(goal, existing)
      if (list.length === 0) {
        error.value = '这次没拆出来，换个说法再试试呀'
        return
      }
      resultTasks.value = list
      selected.value = list.map(() => true)
    } else if (props.mode === 'plan') {
      const input: PlanTaskInput[] = upcoming.value.map(event => ({
        title: event.title,
        dueDate: eventDate(event.at),
        priority: 0,
        pomodoros: 0,
      }))
      if (input.length === 0) {
        error.value = '日程还空空的，先记几件事再让我安排嘛'
        return
      }
      resultText.value = await suggestToday(input, todayStat.value?.pomodoros ?? 0)
    } else {
      resultText.value = await summarizeMemo(props.memoContent ?? '', memoStyle.value)
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function changeMemoStyle(style: 'summary' | 'checklist') {
  if (memoStyle.value === style && resultText.value) return
  memoStyle.value = style
  resultText.value = ''
  await generate()
}

function addTo(target: 'today' | 'inbox') {
  if (selectedTitles.value.length === 0) return
  emit('addTasks', { titles: [...selectedTitles.value], target })
}

async function copyResult() {
  if (!resultText.value) return
  try {
    await writeText(resultText.value)
    copied.value = true
    window.setTimeout(() => { copied.value = false }, 1500)
  } catch {
    error.value = '没抄上呀，手动选一下好不好'
  }
}

function insertResult() {
  if (!resultText.value) return
  emit('insert', resultText.value)
}

function toggleTask(index: number) {
  selected.value[index] = !selected.value[index]
}

function onBackdropClick(event: MouseEvent) {
  if (event.target === event.currentTarget) emit('close')
}
</script>

<template>
  <div class="ai-backdrop" @click="onBackdropClick">
    <div class="ai-panel" @click.stop>
      <header class="ai-header">
        <span class="ai-title">{{ title }}</span>
        <button class="ai-close" title="关了呀" @click="emit('close')">✕</button>
      </header>

      <div v-if="!configured" class="ai-empty">
        我还没拿到钥匙呢～去「设置 → 小管家」填一下呀
      </div>

      <template v-else>
        <div v-if="mode === 'breakdown'" class="ai-body">
          <textarea
            v-model="prompt"
            class="ai-input"
            rows="2"
            placeholder="想做什么呀？比如「准备下周的组会汇报」"
          ></textarea>
          <button class="ai-primary" :disabled="loading" @click="generate">
            {{ loading ? '拆着呢…' : (hasResult ? '再拆一次' : '拆一拆') }}
          </button>

          <div v-if="resultTasks.length > 0" class="ai-list">
            <label
              v-for="(task, index) in resultTasks"
              :key="index"
              class="ai-list-item"
            >
              <input type="checkbox" :checked="selected[index]" @change="toggleTask(index)" />
              <span>{{ task }}</span>
            </label>
          </div>

          <div v-if="resultTasks.length > 0" class="ai-actions">
            <button class="ai-ghost" @click="addTo('inbox')">先放一边</button>
            <button class="ai-primary" @click="addTo('today')">放进今天（{{ selectedTitles.length }}）</button>
          </div>
        </div>

        <div v-else-if="mode === 'plan'" class="ai-body">
          <p class="ai-desc">看看现在先做哪件最合适呀。</p>
          <button class="ai-primary" :disabled="loading" @click="generate">
            {{ loading ? '想着呢…' : (hasResult ? '再想一次' : '想想先做什么') }}
          </button>
          <pre v-if="resultText" class="ai-result">{{ resultText }}</pre>
          <div v-if="resultText" class="ai-actions">
            <button class="ai-ghost" @click="copyResult">{{ copied ? '抄好啦' : '抄一份' }}</button>
            <button class="ai-primary" @click="emit('close')">知道啦</button>
          </div>
        </div>

        <div v-else class="ai-body">
          <div class="ai-style-row">
            <button
              class="ai-chip"
              :class="{ active: memoStyle === 'checklist' }"
              :disabled="loading"
              @click="changeMemoStyle('checklist')"
            >要点清单</button>
            <button
              class="ai-chip"
              :class="{ active: memoStyle === 'summary' }"
              :disabled="loading"
              @click="changeMemoStyle('summary')"
            >摘要</button>
            <button class="ai-ghost" :disabled="loading" @click="generate">再理一遍</button>
          </div>
          <pre v-if="resultText" class="ai-result">{{ resultText }}</pre>
          <p v-else-if="!loading" class="ai-desc">点「要点清单」或「摘要」，我就开始理啦～</p>
          <div v-if="resultText" class="ai-actions">
            <button class="ai-ghost" @click="copyResult">{{ copied ? '抄好啦' : '抄一份' }}</button>
            <button class="ai-primary" @click="insertResult">放进小记里</button>
          </div>
        </div>

        <p v-if="error" class="ai-error">{{ error }}</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
@reference "../styles.css";

.ai-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: ai-fade 0.18s ease-out;
}

@keyframes ai-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

.ai-panel {
  width: 340px;
  max-height: 74vh;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background:
    radial-gradient(120% 80% at 50% -20%, color-mix(in srgb, var(--focus-color) 14%, transparent), transparent 60%),
    linear-gradient(180deg, rgba(30, 30, 36, 0.92), rgba(16, 17, 21, 0.9));
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 14px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
  color: rgba(255, 255, 255, 0.9);
  animation: ai-scale 0.22s cubic-bezier(0.2, 0.8, 0.22, 1);
}

@keyframes ai-scale {
  from { opacity: 0; transform: scale(0.94); }
  to { opacity: 1; transform: scale(1); }
}

.ai-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ai-title {
  font-size: 14px;
  font-weight: 600;
}

.ai-close {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.45);
  cursor: pointer;
  font-size: 13px;
}

.ai-close:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.ai-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow-y: auto;
}

.ai-input {
  width: 100%;
  resize: none;
  padding: 9px 11px;
  font-size: 13px;
  font-family: inherit;
  color: #fff;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 9px;
  outline: none;
}

.ai-input:focus {
  border-color: color-mix(in srgb, var(--focus-color) 60%, transparent);
}

.ai-desc {
  margin: 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
  line-height: 1.5;
}

.ai-primary,
.ai-ghost {
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 0.2s, border-color 0.2s, opacity 0.2s;
}

.ai-primary {
  background: color-mix(in srgb, var(--focus-color) 22%, transparent);
  border-color: color-mix(in srgb, var(--focus-color) 38%, transparent);
  color: var(--focus-color);
  font-weight: 500;
}

.ai-primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--focus-color) 32%, transparent);
}

.ai-ghost {
  background: transparent;
  border-color: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.65);
}

.ai-ghost:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}

.ai-primary:disabled,
.ai-ghost:disabled {
  opacity: 0.45;
  cursor: default;
}

.ai-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ai-list-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 7px 9px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.045);
  font-size: 13px;
  line-height: 1.45;
  cursor: pointer;
}

.ai-list-item input {
  margin-top: 2px;
  accent-color: var(--focus-color);
}

.ai-result {
  margin: 0;
  padding: 10px 11px;
  max-height: 34vh;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.82);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 9px;
}

.ai-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.ai-style-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ai-chip {
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 12px;
  font-family: inherit;
  color: rgba(255, 255, 255, 0.55);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  cursor: pointer;
}

.ai-chip.active {
  color: var(--focus-color);
  border-color: color-mix(in srgb, var(--focus-color) 40%, transparent);
  background: color-mix(in srgb, var(--focus-color) 14%, transparent);
}

.ai-style-row .ai-ghost {
  margin-left: auto;
}

.ai-empty {
  padding: 18px 10px;
  font-size: 13px;
  text-align: center;
  color: rgba(255, 255, 255, 0.5);
  line-height: 1.6;
}

.ai-error {
  margin: 0;
  font-size: 12px;
  color: #f87171;
  line-height: 1.5;
}
</style>
