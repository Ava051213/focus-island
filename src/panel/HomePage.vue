<script setup lang="ts">
import { computed, ref } from 'vue'
import { useMemos, type Memo } from '../composables/useMemos'
import { useTimerBridge } from '../composables/useTimerBridge'
import { eventTime, eventsNow, useEvents } from '../composables/useEvents'
import { useAiButler, type CoachFeedback } from '../composables/useAiButler'
import type { CoachPlan } from '../composables/useAi'
import { useWeeklyGoals } from '../composables/useWeeklyGoals'
import { useDailyStats } from '../composables/useDailyStats'
import { toLocalDateStr } from '../utils/date'

const emit = defineEmits<{ navigateEvents: [] }>()

const {
  memos,
  activeMemos,
  completedMemos,
  getDisplayTitle,
  completeMemo,
  restoreMemo,
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
const { coachInsight, dailySummary, refreshCoach, configured, preference } = useAiButler()
const coachMessage = computed(() => coachInsight.value?.coach ?? null)

// 团子的表情跟着本周完成的目标数走
const { doneCount } = useWeeklyGoals()
const mascotFace = computed(() => ['', '🌱', '✨', '🏆'][doneCount.value] ?? '')

// 没配 AI Key 时，首页那张卡改成本地提示，不留空
const { todayStat } = useDailyStats()

/** 30 分钟内要发生的日程，本地提示优先提醒它 */
const soonEvent = computed(() => {
  const now = eventsNow.value.getTime()
  const limitMs = 30 * 60 * 1000
  for (const event of upcomingEvents.value) {
    const time = eventTime(event.at)
    if (!time) continue
    const [hour = 0, minute = 0] = time.split(':').map(Number)
    const [year = 0, month = 0, day = 0] = event.at.split('T')[0].split('-').map(Number)
    const startAt = new Date(year, month - 1, day, hour, minute).getTime()
    const diff = startAt - now
    if (diff > 0 && diff <= limitMs) {
      return { title: event.title, minutes: Math.max(1, Math.round(diff / 60000)) }
    }
  }
  return null
})

function timeWord(): string {
  const hour = new Date().getHours()
  if (hour < 6) return '夜深了'
  if (hour < 11) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

interface LocalCoachMessage {
  text: string
  actionLabel: string | null
  action: 'start' | 'events'
}

const localCoach = computed<LocalCoachMessage>(() => {
  const first = recentMemos.value[0] ?? null
  const pomodoros = todayStat.value.pomodoros

  if (soonEvent.value) {
    return {
      text: `还有 ${soonEvent.value.minutes} 分钟到「${soonEvent.value.title}」，先准备一下吧～`,
      actionLabel: '看日程',
      action: 'events',
    }
  }
  if (pomodoros === 0 && first) {
    return { text: '今天还没开张，先挑一件小事做 25 分钟吧～', actionLabel: '开始', action: 'start' }
  }
  if (pomodoros >= 2) {
    return {
      text: `今天已经 ${pomodoros} 个番茄啦，累了就歇会儿，剩下的明天也行。`,
      actionLabel: first ? '再来一个' : null,
      action: 'start',
    }
  }
  if (first) {
    return {
      text: `${timeWord()}，想做什么就从下面挑一条，我陪你慢慢来～`,
      actionLabel: '开始',
      action: 'start',
    }
  }
  return {
    text: `${timeWord()}，先随手记一条想做的事吧，我陪你一起开始～`,
    actionLabel: null,
    action: 'start',
  }
})

function runLocalCoachAction() {
  if (localCoach.value.action === 'events') {
    emit('navigateEvents')
    return
  }
  const memo = recentMemos.value[0]
  if (memo) startMemo(memo)
}

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

function planEstimate(plan: CoachPlan): number {
  return planMemo(plan)?.estimatedPomodoros ?? 0
}

/** 建议只保留还能对应到进行中小记的条目 */
const suggestedPlans = computed(() =>
  (coachMessage.value?.plans ?? []).filter(plan => !!planMemo(plan)),
)

function dateOffset(offset: number): string {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return toLocalDateStr(date)
}

/** 总结优先展示；当天已有总结后又开始新一轮时，说明当时不是最后一轮，退回普通团子 */
const summaryToShow = computed(() => {
  const summary = dailySummary.value
  if (!summary) return null

  const today = dateOffset(0)
  const yesterday = dateOffset(-1)
  if (summary.date === today) {
    return todayStat.value.pomodoros > summary.pomodoros ? null : summary
  }
  if (summary.date === yesterday && todayStat.value.pomodoros === 0) return summary
  return null
})

const summaryTagLabel = computed(() =>
  summaryToShow.value?.date === dateOffset(0) ? '今日总结' : '昨日总结',
)

const coachLoading = ref(false)
const coachError = ref('')
const coachErrorExpanded = ref(false)
const coachNote = ref('')
// 「我有个想法」输入默认收起，点开才显示
const noteOpen = ref(false)

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
    <section class="coach-card">
      <div class="coach-head">
        <span class="coach-title">团子说<span v-if="mascotFace" class="coach-face">{{ mascotFace }}</span><span v-if="summaryToShow" class="coach-summary-tag">{{ summaryTagLabel }}</span></span>
        <div class="coach-head-actions">
          <button v-if="configured" class="link-btn" @click="noteOpen = !noteOpen">
            {{ noteOpen ? '收起' : '我有个想法' }}
          </button>
        </div>
      </div>
      <template v-if="summaryToShow">
        <p class="coach-greeting">{{ summaryToShow.summary }}</p>
        <p v-if="summaryToShow.tomorrow" class="coach-care">{{ summaryToShow.tomorrow }}</p>
      </template>
      <template v-else-if="configured">
        <p v-if="coachMessage?.greeting" class="coach-greeting">{{ coachMessage.greeting }}</p>
        <p v-else-if="coachInsight" class="coach-content">{{ coachInsight.content }}</p>
        <p v-else class="coach-empty">记点小记，团子就能陪你排啦～</p>
        <p v-if="coachMessage?.care" class="coach-care">{{ coachMessage.care }}</p>
        <div v-if="noteOpen" class="coach-interact">
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
        <p
          v-if="coachError"
          class="coach-error"
          :class="{ expanded: coachErrorExpanded }"
          @click="coachErrorExpanded = !coachErrorExpanded"
        >{{ coachError }}</p>
      </template>
      <template v-else>
        <p class="coach-content">{{ localCoach.text }}</p>
        <div v-if="localCoach.actionLabel && !running" class="coach-local-action">
          <button class="coach-start-btn" @click="runLocalCoachAction">{{ localCoach.actionLabel }}</button>
        </div>
      </template>
    </section>

    <section class="zone">
      <div class="zone-title">
        建议做的事
        <button v-if="configured" class="link-btn" :disabled="coachLoading" @click="handleRefreshCoach">
          {{ coachLoading ? '团子在换…' : '换一批' }}
        </button>
      </div>

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

      <div v-else-if="suggestedPlans.length > 0" class="suggestion-list">
        <div v-for="(plan, index) in suggestedPlans" :key="plan.title" class="suggestion-item">
          <div class="suggestion-copy">
            <div class="suggestion-line">
              <span class="suggestion-rank">{{ index + 1 }}</span>
              <span class="suggestion-title">{{ plan.title }}</span>
              <span class="suggestion-meta">
                <span v-if="plan.when" class="suggestion-when">{{ plan.when }}</span>
                {{ plan.pomodoros }} 个番茄
                <template v-if="planEstimate(plan)"> · 预计 {{ planEstimate(plan) }}</template>
              </span>
            </div>
            <p v-if="plan.reason" class="suggestion-reason">{{ plan.reason }}</p>
          </div>
          <div class="suggestion-actions">
            <button class="coach-start-btn" :disabled="coachLoading" @click="startPlan(plan)">开始</button>
            <button
              class="coach-swap-btn"
              :disabled="coachLoading"
              title="换掉这条，重新安排"
              @click="handleDismissPlan(plan)"
            >换</button>
          </div>
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
        还没有要做的事，去小记页记一条吧～
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

.coach-local-action {
  display: flex;
  justify-content: flex-end;
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

.coach-summary-tag {
  margin-left: 6px;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 9px;
  color: var(--focus-color);
  background: color-mix(in srgb, var(--focus-color) 12%, transparent);
}

/* 建议做的事：团子的安排放在这里，顶部只留情绪 */
.suggestion-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.suggestion-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 11px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.07);
}

.suggestion-item:hover {
  background: rgba(255, 255, 255, 0.07);
  border-color: color-mix(in srgb, var(--focus-color) 22%, rgba(255, 255, 255, 0.08));
}

.suggestion-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.suggestion-line {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.suggestion-rank {
  flex-shrink: 0;
  font-size: 10px;
  color: color-mix(in srgb, var(--focus-color) 75%, transparent);
}

.suggestion-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.86);
}

.suggestion-meta {
  flex-shrink: 0;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.38);
  white-space: nowrap;
}

.suggestion-when {
  margin-right: 4px;
  color: color-mix(in srgb, var(--focus-color) 65%, transparent);
}

.suggestion-reason {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  line-height: 1.4;
  color: rgba(255, 255, 255, 0.4);
}

.suggestion-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
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

.empty {
  padding: 22px 14px;
  border-radius: 8px;
  border: 1px dashed rgba(255, 255, 255, 0.08);
  font-size: 12px;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.3);
  text-align: center;
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
