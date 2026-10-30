<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useAiButler } from '../composables/useAiButler'
import { useTasks } from '../composables/useTasks'

const emit = defineEmits<{ back: [] }>()

const { addTask } = useTasks()
const {
  insights,
  coachInsight,
  reviewInsight,
  configured,
  autoEnabled,
  markSeen,
  refreshCoach,
  reviewPlan,
  nameIdeas,
} = useAiButler()

const coachLoading = ref(false)
const coachError = ref('')

const planText = ref('')
const planExtra = ref('')
const planLoading = ref(false)
const planError = ref('')

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
  const plan = planText.value.trim()
  if (!plan) {
    planError.value = '先粘贴或写下你的计划'
    return
  }
  planError.value = ''
  planLoading.value = true
  try {
    await reviewPlan(plan, planExtra.value.trim())
    markSeen()
  } catch (e) {
    planError.value = e instanceof Error ? e.message : String(e)
  } finally {
    planLoading.value = false
  }
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
        <span class="card-title">计划评估</span>
      </div>
      <textarea
        v-model="planText"
        class="textarea"
        rows="4"
        placeholder="粘贴你的计划，例如：一周内完成 Redis 基础和项目重构，每天可投入 3 小时"
      ></textarea>
      <textarea
        v-model="planExtra"
        class="textarea small"
        rows="2"
        placeholder="补充说明（可选）：硬性截止日、每天可投入时长、不能动的安排"
      ></textarea>
      <button class="primary-btn" :disabled="!configured || planLoading" @click="handleReviewPlan">
        {{ planLoading ? '评估中…' : '评估并给出粗略安排' }}
      </button>
      <pre v-if="reviewInsight" class="result">{{ reviewInsight.content }}</pre>
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
