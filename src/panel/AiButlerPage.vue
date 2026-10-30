<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useAiButler } from '../composables/useAiButler'
import { useAi } from '../composables/useAi'
import { useMemos } from '../composables/useMemos'
import { useTasks } from '../composables/useTasks'

const emit = defineEmits<{ back: [] }>()

const { addTask, activeTasks } = useTasks()
const { addMemo, updateMemo } = useMemos()
const { generatePlan } = useAi()

const {
  insights,
  coachInsight,
  configured,
  autoEnabled,
  markSeen,
  refreshCoach,
  nameIdeas,
} = useAiButler()

const coachLoading = ref(false)
const coachError = ref('')

const planPrompt = ref('')
const planExtra = ref('')
const planLoading = ref(false)
const planError = ref('')
const planMessage = ref('')
const planGenerated = ref(false)
const planTasks = ref<string[]>([])
const planSelected = ref<boolean[]>([])
const memoTitle = ref('')
const memoContent = ref('')

const idea = ref('')
const names = ref<string[]>([])
const nameLoading = ref(false)
const nameError = ref('')

onMounted(() => markSeen())

function formatTime(ts: number) {
  const d = new Date(ts)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${mi}`
}

async function handleRefreshCoach() {
  if (coachLoading.value) return
  coachError.value = ''
  coachLoading.value = true
  try {
    await refreshCoach()
    markSeen()
  } catch (e) {
    coachError.value = e instanceof Error ? e.message : String(e)
  } finally {
    coachLoading.value = false
  }
}

async function handleReviewPlan() {
  if (planLoading.value) return
  const prompt = planPrompt.value.trim()
  if (!prompt) {
    planError.value = '先描述你想做的事'
    return
  }
  planError.value = ''
  planMessage.value = ''
  planLoading.value = true
  try {
    const tasks = activeTasks.value.slice(0, 12).map(task => ({
      title: task.title,
      dueDate: task.dueDate ?? null,
      priority: task.priority ?? 0,
      pomodoros: task.pomodoroCount ?? 0,
    }))
    const result = await generatePlan(prompt, planExtra.value.trim(), tasks)
    planTasks.value = result.tasks
    planSelected.value = result.tasks.map(() => true)
    memoTitle.value = result.memoTitle
    memoContent.value = result.memoContent
    planGenerated.value = true
    if (result.tasks.length === 0 && result.memoContent.length === 0) {
      planError.value = '没有生成内容，换个说法再试'
    }
  } catch (e) {
    planError.value = e instanceof Error ? e.message : String(e)
  } finally {
    planLoading.value = false
  }
}

function escapeHtml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function refreshQuietly() {
  try {
    await refreshCoach()
    markSeen()
  } catch {
    // 忽略自动刷新失败
  }
}

function writePlanTasks() {
  const selected = planTasks.value.filter((_, index) => planSelected.value[index])
  if (selected.length === 0) {
    planMessage.value = '没有勾选任务'
    return
  }
  for (const title of selected) addTask(title, null)
  planTasks.value = []
  planSelected.value = []
  planMessage.value = `已写入 ${selected.length} 个任务到「想做」`
  void refreshQuietly()
}

function writePlanMemo() {
  const body = memoContent.value.trim()
  if (!body) {
    planMessage.value = '备忘内容为空'
    return
  }
  const title = memoTitle.value.trim() || '计划草稿'
  const memo = addMemo()
  updateMemo(memo.id, {
    title,
    content: escapeHtml(body).split('\n').join('<br>'),
  })
  planMessage.value = '已保存到备忘录'
  void refreshQuietly()
}

async function handleNameIdeas() {
  if (nameLoading.value) return
  const text = idea.value.trim()
  if (!text) {
    nameError.value = '先写一句粗糙的想法'
    return
  }
  nameError.value = ''
  nameLoading.value = true
  try {
    names.value = await nameIdeas(text)
    if (names.value.length === 0) nameError.value = '没有生成候选，换个说法再试'
  } catch (e) {
    nameError.value = e instanceof Error ? e.message : String(e)
  } finally {
    nameLoading.value = false
  }
}

function useName(name: string) {
  addTask(name)
  names.value = names.value.filter(item => item !== name)
}
</script>

<template>
  <div class="ai-page">
    <div class="page-header">
      <button class="back-btn" title="返回" @click="emit('back')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
      </button>
      <span class="page-title">AI 管家</span>
      <span class="auto-state">{{ autoEnabled ? '自动' : '手动' }}</span>
    </div>

    <div v-if="!configured" class="notice">
      还没有配置 API Key。请到「设置 → AI 助手」填写后使用。
    </div>

    <section class="card">
      <div class="card-head">
        <span class="card-title">今日管家</span>
        <button class="text-btn" :disabled="!configured || coachLoading" @click="handleRefreshCoach">
          {{ coachLoading ? '生成中…' : '立即生成' }}
        </button>
      </div>
      <p v-if="coachInsight" class="coach-content">{{ coachInsight.content }}</p>
      <p v-else class="empty-hint">记录今日备忘或任务后，这里会自动给出下一步建议。</p>
      <p v-if="coachInsight" class="meta">更新于 {{ formatTime(coachInsight.createdAt) }}</p>
      <p v-if="coachError" class="error">{{ coachError }}</p>
    </section>

    <section class="card">
      <div class="card-head">
        <span class="card-title">AI 规划</span>
      </div>
      <textarea
        v-model="planPrompt"
        class="textarea"
        rows="3"
        placeholder="描述你想做的事，例如：这周把 Redis 基础过完，再推进项目重构"
      ></textarea>
      <textarea
        v-model="planExtra"
        class="textarea small"
        rows="2"
        placeholder="补充（可选）：每天能投入多久、硬性截止、不能动的安排"
      ></textarea>
      <button class="primary-btn" :disabled="!configured || planLoading" @click="handleReviewPlan">
        {{ planLoading ? '生成中…' : '生成任务与备忘' }}
      </button>

      <div v-if="planTasks.length > 0" class="plan-list">
        <label v-for="(task, index) in planTasks" :key="index" class="plan-row">
          <input type="checkbox" :checked="planSelected[index]" @change="planSelected[index] = !planSelected[index]" />
          <span>{{ task }}</span>
        </label>
      </div>

      <template v-if="planGenerated">
        <input v-model="memoTitle" class="input" placeholder="备忘标题" />
        <textarea v-model="memoContent" class="textarea" rows="5" placeholder="备忘内容"></textarea>
        <div class="plan-actions">
          <button class="small-btn" :disabled="planLoading" @click="writePlanMemo">保存备忘</button>
          <button class="primary-btn compact" :disabled="planLoading || planTasks.length === 0" @click="writePlanTasks">
            写入想做
          </button>
        </div>
        <p v-if="planMessage" class="meta">{{ planMessage }}</p>
      </template>

      <p v-if="planError" class="error">{{ planError }}</p>
    </section>

    <section class="card">
      <div class="card-head">
        <span class="card-title">命名助手</span>
      </div>
      <div class="name-row">
        <input
          v-model="idea"
          class="input"
          placeholder="粗糙想法，如「搞一下组会」"
          @keydown.enter.prevent="handleNameIdeas"
        />
        <button class="small-btn" :disabled="!configured || nameLoading" @click="handleNameIdeas">
          {{ nameLoading ? '…' : '起名' }}
        </button>
      </div>
      <div v-if="names.length > 0" class="name-list">
        <button v-for="name in names" :key="name" class="name-chip" title="点击创建今日任务" @click="useName(name)">
          {{ name }}
        </button>
      </div>
      <p v-if="names.length > 0" class="meta">点击候选即创建为今日任务</p>
      <p v-if="nameError" class="error">{{ nameError }}</p>
    </section>

    <section class="card">
      <div class="card-head">
        <span class="card-title">历史记录</span>
        <span class="meta">{{ insights.length }} 条</span>
      </div>
      <div v-if="insights.length === 0" class="empty-hint">还没有记录。</div>
      <div v-else class="history">
        <article v-for="item in insights.slice(0, 10)" :key="item.id" class="history-item">
          <div class="history-head">
            <span class="history-kind">{{ item.title }}</span>
            <span class="meta">{{ formatTime(item.createdAt) }}</span>
          </div>
          <p class="history-content">{{ item.content }}</p>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
@reference "../styles.css";

.ai-page {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  height: 100%;
  overflow-y: auto;
  color: rgba(255, 255, 255, 0.9);
}

.ai-page::-webkit-scrollbar {
  width: 4px;
}

.ai-page::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 2px;
}

.page-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.back-btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
}

.back-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}

.page-title {
  font-size: 14px;
  font-weight: 600;
}

.auto-state {
  margin-left: auto;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
}

.notice {
  padding: 9px 11px;
  font-size: 12px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.55);
  background: color-mix(in srgb, var(--focus-color) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--focus-color) 25%, transparent);
  border-radius: 9px;
}

.card {
  padding: 11px 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card-title {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.7);
}

.text-btn {
  padding: 0;
  background: transparent;
  border: none;
  font-size: 11px;
  font-family: inherit;
  color: var(--focus-color);
  cursor: pointer;
}

.text-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.coach-content {
  margin: 0;
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-wrap;
}

.empty-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.35);
}

.meta {
  margin: 0;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.3);
}

.textarea,
.input {
  width: 100%;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.55;
  font-family: inherit;
  color: #fff;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 8px;
  outline: none;
  resize: vertical;
  box-sizing: border-box;
}

.textarea:focus,
.input:focus {
  border-color: color-mix(in srgb, var(--focus-color) 55%, transparent);
}

.textarea.small {
  font-size: 11px;
}

.primary-btn {
  height: 32px;
  border-radius: 8px;
  font-size: 12px;
  font-family: inherit;
  font-weight: 500;
  color: var(--focus-color);
  background: color-mix(in srgb, var(--focus-color) 18%, transparent);
  border: 1px solid color-mix(in srgb, var(--focus-color) 35%, transparent);
  cursor: pointer;
}

.primary-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.result {
  margin: 0;
  padding: 9px 10px;
  max-height: 26vh;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 12px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.78);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
}

.plan-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.plan-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 7px 9px;
  font-size: 12px;
  line-height: 1.5;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  cursor: pointer;
}

.plan-row input {
  margin-top: 2px;
  accent-color: var(--focus-color);
}

.plan-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.primary-btn.compact {
  padding: 0 12px;
}

.name-row {
  display: flex;
  gap: 6px;
}

.input {
  flex: 1;
  min-width: 0;
  height: 30px;
  padding: 0 9px;
  resize: none;
}

.small-btn {
  flex-shrink: 0;
  height: 30px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 12px;
  font-family: inherit;
  color: rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  cursor: pointer;
}

.small-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.name-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.name-chip {
  padding: 6px 10px;
  font-size: 12px;
  font-family: inherit;
  color: rgba(255, 255, 255, 0.75);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
}

.name-chip:hover {
  color: var(--focus-color);
  border-color: color-mix(in srgb, var(--focus-color) 40%, transparent);
  background: color-mix(in srgb, var(--focus-color) 12%, transparent);
}

.error {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: #f87171;
}

.history {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.history-item {
  padding: 8px 9px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
}

.history-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
}

.history-kind {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
}

.history-content {
  margin: 0;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  color: rgba(255, 255, 255, 0.7);
}
</style>
