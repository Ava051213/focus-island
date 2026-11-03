<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useMemos, type Memo } from '../composables/useMemos'
import { useTimerBridge } from '../composables/useTimerBridge'
import { eventRelativeLabel, eventTime, eventsNow, useEvents } from '../composables/useEvents'
import { useAiButler, type CoachFeedback } from '../composables/useAiButler'
import type { CoachPlan } from '../composables/useAi'
import { useWeeklyGoals } from '../composables/useWeeklyGoals'
import WeeklyGoals from './WeeklyGoals.vue'

const emit = defineEmits<{ navigateEvents: [] }>()

const {
  memos,
  activeMemos,
  completedMemos,
  getDisplayTitle,
  completeMemo,
  restoreMemo,
  addQuickMemo,
} = useMemos()
const { withinDays } = useEvents()
const {
  start,
  pause,
  resume,
  abandon,
  running,
  phase,
  displayTime,
  activeTaskId,
  activeTaskTitle,
} = useTimerBridge()

/** 按用户拖好的顺序取前三条，作为「现在可以动手」的候选 */
const recentMemos = computed(() => activeMemos.value.slice(0, 3))

const upcomingEvents = computed(() => withinDays(7).slice(0, 5))

/** 随手记一句：回车或点按钮保存，不选分类、不写标题 */
const quickText = ref('')
const quickSaved = ref(false)
let quickSavedTimer: ReturnType<typeof setTimeout> | null = null

function saveQuickMemo() {
  const created = addQuickMemo(quickText.value)
  if (!created) return
  quickText.value = ''
  quickSaved.value = true
  if (quickSavedTimer) clearTimeout(quickSavedTimer)
  quickSavedTimer = setTimeout(() => {
    quickSaved.value = false
  }, 1600)
}

function onQuickEnter(event: KeyboardEvent) {
  // 中文输入法还在选词时，回车是确认候选，不是保存
  if (event.isComposing) return
  event.preventDefault()
  saveQuickMemo()
}

function startMemo(memo: Memo) {
  start(memo.id, getDisplayTitle(memo))
}

const undoState = ref<{ id: string; title: string; count: number } | null>(null)
let undoTimer: ReturnType<typeof setTimeout> | null = null

function todayCompletedCount(): number {
  const now = new Date()
  return completedMemos.value.filter((memo) => {
    if (!memo.completedAt) return false
    const done = new Date(memo.completedAt)
    return done.getFullYear() === now.getFullYear()
      && done.getMonth() === now.getMonth()
      && done.getDate() === now.getDate()
  }).length
}

function completeHomeMemo(memo: Memo, event: Event) {
  event.stopPropagation()
  undoState.value = {
    id: memo.id,
    title: getDisplayTitle(memo),
    count: todayCompletedCount() + 1,
  }
  completeMemo(memo.id)
  if (undoTimer) clearTimeout(undoTimer)
  undoTimer = setTimeout(() => {
    undoState.value = null
  }, 5000)
}

function undoComplete() {
  if (!undoState.value) return
  restoreMemo(undoState.value.id)
  undoState.value = null
  if (undoTimer) clearTimeout(undoTimer)
}

/** 团子的建议直接放在首页，不再单独占一个页面 */
const { coachInsight, refreshCoach, configured, preference } = useAiButler()
const coachMessage = computed(() => coachInsight.value?.coach ?? null)

// 团子的表情跟着本周完成的目标数走
const { doneCount } = useWeeklyGoals()
const mascotFace = computed(() => ['', '🌱', '✨', '🏆'][doneCount.value] ?? '')

function planMemo(plan: CoachPlan): Memo | null {
  if (plan.memoId) {
    const matched = memos.value.find(memo => memo.id === plan.memoId && !memo.completedAt)
    if (matched) return matched
  }
  return memos.value.find(memo => !memo.completedAt && getDisplayTitle(memo) === plan.title) ?? null
}

function startPlan(plan: CoachPlan) {
  const memo = planMemo(plan)
  if (memo) start(memo.id, getDisplayTitle(memo))
}
const coachLoading = ref(false)
const coachError = ref('')
const coachErrorExpanded = ref(false)
const coachNote = ref('')
// 默认收起，首屏优先留给计时和今天要做的事
const coachExpanded = ref(false)

// 新一轮计时开始时自动收起，用户手动展开后本轮不再反复切
watch(activeTaskId, (next, prev) => {
  if (next && !prev) coachExpanded.value = false
})

async function runCoach(feedback: CoachFeedback = {}) {
  if (coachLoading.value) return
  coachLoading.value = true
  coachError.value = ''
  coachErrorExpanded.value = false
  try {
    await refreshCoach(feedback)
  } catch (e) {
    coachError.value = e instanceof Error ? e.message : String(e)
  } finally {
    coachLoading.value = false
  }
}

function handleRefreshCoach() {
  void runCoach()
}

function handlePreference(next: 'hard-first' | 'easy-first') {
  void runCoach({ preference: next })
}

function handleDismissPlan(plan: CoachPlan) {
  void runCoach({ dismissTitle: plan.title })
}

function sendCoachNote() {
  const text = coachNote.value.trim()
  if (!text || coachLoading.value) return
  coachNote.value = ''
  void runCoach({ userNote: text })
}

function onCoachNoteEnter(event: KeyboardEvent) {
  // 中文输入法还在选词时，回车是确认候选，不是发送
  if (event.isComposing) return
  event.preventDefault()
  sendCoachNote()
}
</script>

<template>
  <div class="home-page">
    <section v-if="configured" class="coach-card">
      <div class="coach-head">
        <span class="coach-title">团子说<span v-if="mascotFace" class="coach-face">{{ mascotFace }}</span></span>
        <div class="coach-head-actions">
          <button class="link-btn" :disabled="coachLoading" @click="handleRefreshCoach">
            {{ coachLoading ? '团子正在想…' : '再想想' }}
          </button>
          <button v-if="coachMessage" class="link-btn" @click="coachExpanded = !coachExpanded">
            {{ coachExpanded ? '收起' : '展开' }}
          </button>
        </div>
      </div>
      <template v-if="coachMessage">
        <p v-if="coachMessage.greeting" class="coach-greeting">{{ coachMessage.greeting }}</p>

        <!-- 收起时只留第一条安排和一个开始按钮 -->
        <div v-if="!coachExpanded && coachMessage.plans.length > 0" class="coach-preview">
          <div class="coach-preview-copy">
            <span class="coach-preview-title">{{ coachMessage.plans[0].title }}</span>
            <span class="coach-preview-meta">
              <span v-if="coachMessage.plans[0].when" class="coach-preview-when">{{ coachMessage.plans[0].when }}</span>
              {{ coachMessage.plans[0].pomodoros }} 个番茄
            </span>
          </div>
          <button
            v-if="planMemo(coachMessage.plans[0])"
            class="coach-start-btn"
            :disabled="coachLoading"
            @click="startPlan(coachMessage.plans[0])"
          >开始</button>
        </div>

        <div v-if="coachExpanded && coachMessage.plans.length > 0" class="coach-plans">
          <div v-for="(plan, index) in coachMessage.plans" :key="index" class="coach-plan">
            <div class="coach-plan-copy">
              <div class="coach-plan-line">
                <span class="coach-plan-index">{{ index + 1 }}</span>
                <span class="coach-plan-title">{{ plan.title }}</span>
                <span class="coach-plan-pomo">{{ plan.pomodoros }} 个番茄</span>
              </div>
              <p class="coach-plan-reason">
                <span v-if="plan.when" class="coach-plan-when">{{ plan.when }}</span>{{ plan.reason }}
              </p>
            </div>
            <div class="coach-plan-actions">
              <button
                v-if="planMemo(plan)"
                class="coach-start-btn"
                :disabled="coachLoading"
                @click="startPlan(plan)"
              >开始</button>
              <button
                class="coach-swap-btn"
                :disabled="coachLoading"
                title="换掉这条，重新安排"
                @click="handleDismissPlan(plan)"
              >换</button>
            </div>
          </div>
        </div>

        <div v-if="coachExpanded" class="coach-interact">
          <div class="coach-prefs">
            <button
              class="coach-pref-btn"
              :class="{ active: preference === 'hard-first' }"
              :disabled="coachLoading"
              @click="handlePreference('hard-first')"
            >先啃难的</button>
            <button
              class="coach-pref-btn"
              :class="{ active: preference === 'easy-first' }"
              :disabled="coachLoading"
              @click="handlePreference('easy-first')"
            >先做轻松的</button>
          </div>
          <div class="coach-note-row">
            <input
              v-model="coachNote"
              class="coach-note-input"
              type="text"
              placeholder="跟团子说一句，比如「我有点累」"
              :disabled="coachLoading"
              @keydown.enter="onCoachNoteEnter"
            />
            <button
              class="coach-send-btn"
              :disabled="coachLoading || !coachNote.trim()"
              @click="sendCoachNote"
            >说</button>
          </div>
        </div>

        <p v-if="coachExpanded && coachMessage.care" class="coach-care">{{ coachMessage.care }}</p>
        <p v-if="coachExpanded && coachMessage.closing" class="coach-closing">{{ coachMessage.closing }}</p>
      </template>
      <p v-else-if="coachInsight" class="coach-content">{{ coachInsight.content }}</p>
      <p v-else class="coach-empty">记点小记或日程，团子就能帮你排啦～</p>
      <p
        v-if="coachError"
        class="coach-error"
        :class="{ expanded: coachErrorExpanded }"
        @click="coachErrorExpanded = !coachErrorExpanded"
      >{{ coachError }}</p>
    </section>

    <WeeklyGoals compact />

    <div class="quick-capture">
      <input
        v-model="quickText"
        class="quick-input"
        type="text"
        :placeholder="quickSaved ? '记下了，等你想整理再打开' : '想到什么，随手记一句'"
        @input="quickSaved = false"
        @keydown.enter="onQuickEnter"
      />
      <button class="quick-save-btn" :disabled="!quickText.trim()" @click="saveQuickMemo">记下</button>
    </div>

    <section class="zone">
      <div class="zone-title">现在陪你做</div>

      <div v-if="activeTaskId" class="running-card">
        <div class="running-main">
          <span class="running-phase">{{ phase === 'focus' ? '陪你专注中' : '陪你歇着' }}</span>
          <span class="running-title">{{ activeTaskTitle ?? '还没想好名字' }}</span>
        </div>
        <span class="running-time">{{ displayTime }}</span>
        <div class="running-actions">
          <button class="round-btn" @click="running ? pause() : resume()">
            {{ running ? '歇一下' : '继续呀' }}
          </button>
          <button class="round-btn stop" @click="abandon()">不做了</button>
        </div>
      </div>

      <div v-else-if="recentMemos.length > 0" class="memo-list">
        <div v-for="memo in recentMemos" :key="memo.id" class="memo-row">
          <button class="home-check-btn" @click="(e) => completeHomeMemo(memo, e)" title="做完了，收起来">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
              <polyline points="4 12 9 17 20 6"/>
            </svg>
          </button>
          <span class="memo-title">{{ getDisplayTitle(memo) }}</span>
          <button class="play-btn" @click="startMemo(memo)" title="陪我专注一会儿呀">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z"/></svg>
          </button>
        </div>
        <p class="memo-hint">戳右边的 ▶，我们就安静 25 分钟好不好～</p>
      </div>

      <div v-else class="empty">
        还没有小记呢～先去「小记」随手写一条，回来我陪你开始呀
      </div>
    </section>

    <section class="zone">
      <div class="zone-title">
        这几天要做的
        <button class="link-btn" @click="emit('navigateEvents')">都看看 ›</button>
      </div>

      <div v-if="upcomingEvents.length > 0" class="event-list">
        <button
          v-for="event in upcomingEvents"
          :key="event.id"
          class="event-line"
          @click="emit('navigateEvents')"
        >
          <span class="event-day">{{ eventRelativeLabel(event.at, eventsNow) }}</span>
          <span v-if="eventTime(event.at)" class="event-clock">{{ eventTime(event.at) }}</span>
          <span class="event-title">{{ event.title }}</span>
        </button>
      </div>

      <div v-else class="empty small">
        这七天干干净净的，正好留给想做的事呀～
      </div>
    </section>

    <div v-if="undoState" class="undo-toast">
      <span class="undo-text">团子收下「{{ undoState.title }}」啦，今天第 {{ undoState.count }} 条</span>
      <button class="undo-btn" @click="undoComplete">撤销</button>
    </div>
  </div>
</template>

<style scoped>
@reference "../styles.css";

.home-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
}

.zone {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

/* 随手记一句的轻输入，不占额外页面 */
.quick-capture {
  display: flex;
  gap: 6px;
}

.quick-input {
  flex: 1;
  min-width: 0;
  height: 30px;
  padding: 0 9px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.85);
  font-size: 12px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s;
}

.quick-input::placeholder {
  color: rgba(255, 255, 255, 0.28);
}

.quick-input:focus {
  border-color: color-mix(in srgb, var(--focus-color) 45%, transparent);
}

.quick-save-btn {
  flex-shrink: 0;
  padding: 0 12px;
  height: 30px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--focus-color) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--focus-color) 38%, transparent);
  color: var(--focus-color);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
}

.quick-save-btn:hover {
  background: color-mix(in srgb, var(--focus-color) 28%, transparent);
}

.quick-save-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

/* 小管家建议卡：一句话就够，不再单独占一页 */
.coach-card {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 9px 11px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--focus-color) 9%, rgba(255, 255, 255, 0.03));
  border: 1px solid color-mix(in srgb, var(--focus-color) 22%, transparent);
}

.coach-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.coach-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.coach-title {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--focus-color) 82%, transparent);
}

.coach-face {
  margin-left: 4px;
  font-size: 11px;
  letter-spacing: 0;
}

.coach-content {
  margin: 0;
  font-size: 12px;
  line-height: 1.65;
  white-space: pre-wrap;
  color: rgba(255, 255, 255, 0.82);
}

.coach-greeting {
  margin: 0;
  font-size: 12px;
  line-height: 1.65;
  color: rgba(255, 255, 255, 0.86);
}

/* 收起时的第一条安排 */
.coach-preview {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.coach-preview-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.coach-preview-title {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.9);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.coach-preview-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10.5px;
  color: rgba(255, 255, 255, 0.42);
}

.coach-preview-when {
  color: color-mix(in srgb, var(--focus-color) 75%, transparent);
}

.coach-plans {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.coach-plan {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.coach-plan-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.coach-plan-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.coach-plan-index {
  flex-shrink: 0;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 700;
  color: var(--focus-color);
  background: color-mix(in srgb, var(--focus-color) 16%, transparent);
}

.coach-plan-title {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.9);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.coach-plan-pomo {
  flex-shrink: 0;
  font-size: 10px;
  color: color-mix(in srgb, var(--focus-color) 78%, transparent);
}

.coach-plan-reason {
  margin: 0;
  padding-left: 21px;
  font-size: 10.5px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.42);
}

.coach-start-btn {
  flex-shrink: 0;
  padding: 4px 9px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--focus-color) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--focus-color) 34%, transparent);
  color: var(--focus-color);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
}

.coach-start-btn:hover {
  background: color-mix(in srgb, var(--focus-color) 28%, transparent);
}

.coach-start-btn:disabled,
.coach-swap-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.coach-plan-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}

.coach-swap-btn {
  padding: 4px 7px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.45);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
}

.coach-swap-btn:hover {
  color: rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.1);
}

.coach-plan-when {
  margin-right: 6px;
  color: color-mix(in srgb, var(--focus-color) 75%, transparent);
  font-variant-numeric: tabular-nums;
}

.coach-interact {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 2px;
}

.coach-prefs {
  display: flex;
  gap: 6px;
}

.coach-pref-btn {
  padding: 4px 9px;
  border-radius: 999px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.5);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
}

.coach-pref-btn:hover {
  border-color: color-mix(in srgb, var(--focus-color) 40%, transparent);
  color: rgba(255, 255, 255, 0.8);
}

.coach-pref-btn.active {
  background: color-mix(in srgb, var(--focus-color) 16%, transparent);
  border-color: color-mix(in srgb, var(--focus-color) 45%, transparent);
  color: var(--focus-color);
}

.coach-pref-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.coach-note-row {
  display: flex;
  gap: 6px;
}

.coach-note-input {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 9px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.85);
  font-size: 12px;
  font-family: inherit;
  outline: none;
}

.coach-note-input::placeholder {
  color: rgba(255, 255, 255, 0.28);
}

.coach-note-input:focus {
  border-color: color-mix(in srgb, var(--focus-color) 45%, transparent);
}

.coach-note-input:disabled {
  opacity: 0.5;
}

.coach-send-btn {
  flex-shrink: 0;
  padding: 0 12px;
  height: 28px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--focus-color) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--focus-color) 38%, transparent);
  color: var(--focus-color);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}

.coach-send-btn:hover {
  background: color-mix(in srgb, var(--focus-color) 28%, transparent);
}

.coach-send-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.coach-care {
  margin: 0;
  padding-top: 5px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 11px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.5);
}

.coach-closing {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  color: color-mix(in srgb, var(--focus-color) 62%, rgba(255, 255, 255, 0.4));
}

.coach-empty {
  margin: 0;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
}

.coach-error {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: #f87171;
  cursor: pointer;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.coach-error.expanded {
  display: block;
  -webkit-line-clamp: unset;
}

.zone-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.3);
  padding: 0 2px;
}

.link-btn {
  background: none;
  border: none;
  /* 扩大点击区域，但不影响排版 */
  padding: 2px 4px;
  margin: -2px -4px;
  color: rgba(255, 255, 255, 0.35);
  font-size: 10px;
  font-family: inherit;
  cursor: pointer;
  letter-spacing: 0;
  text-transform: none;
}

.link-btn:hover {
  color: var(--focus-color);
}

.link-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.running-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--focus-color) 12%, rgba(255, 255, 255, 0.04));
  border: 1px solid color-mix(in srgb, var(--focus-color) 30%, transparent);
}

.running-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.running-phase {
  font-size: 10px;
  color: color-mix(in srgb, var(--focus-color) 85%, transparent);
}

.running-title {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.92);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.running-time {
  font-size: 18px;
  font-variant-numeric: tabular-nums;
  color: var(--focus-color);
}

.running-actions {
  display: flex;
  gap: 5px;
}

.round-btn {
  padding: 4px 9px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.7);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
}

.round-btn:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.14);
}

.round-btn.stop:hover {
  color: #f87171;
  border-color: rgba(248, 113, 113, 0.35);
}

.memo-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.memo-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.06);
  transition: background 0.15s;
}

.memo-row:hover {
  background: rgba(255, 255, 255, 0.07);
}

.home-check-btn {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, 0.18);
  background: transparent;
  color: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s;
}

.home-check-btn:hover {
  border-color: color-mix(in srgb, var(--focus-color) 60%, transparent);
  background: color-mix(in srgb, var(--focus-color) 12%, transparent);
  color: color-mix(in srgb, var(--focus-color) 80%, transparent);
}

.memo-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.88);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.play-btn {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--focus-color) 18%, transparent);
  border: 1px solid color-mix(in srgb, var(--focus-color) 40%, transparent);
  color: var(--focus-color);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s;
}

.play-btn:hover {
  background: color-mix(in srgb, var(--focus-color) 35%, transparent);
}

.memo-hint {
  margin: 2px 0 0;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.25);
}

.event-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.event-line {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 9px;
  border-radius: 7px;
  background: transparent;
  border: 1px solid transparent;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: all 0.15s;
}

.event-line:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.07);
}

.event-day {
  flex-shrink: 0;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  width: 34px;
}

.event-clock {
  flex-shrink: 0;
  font-size: 10px;
  color: color-mix(in srgb, var(--focus-color) 80%, transparent);
  font-variant-numeric: tabular-nums;
}

.event-title {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.78);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty {
  padding: 22px 14px;
  border-radius: 8px;
  border: 1px dashed rgba(255, 255, 255, 0.08);
  font-size: 12px;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.3);
  text-align: center;
}

.empty.small {
  padding: 16px;
  font-size: 11px;
}

.undo-toast {
  position: fixed;
  left: 50%;
  bottom: 64px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  border-radius: 9px;
  background: rgba(30, 30, 34, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  z-index: 1100;
  white-space: nowrap;
}

.undo-text {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.75);
}

.undo-btn {
  background: none;
  border: none;
  padding: 0;
  color: var(--focus-color);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}

.undo-btn:hover {
  text-decoration: underline;
}
</style>
