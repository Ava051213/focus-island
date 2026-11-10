<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from 'vue'
import { useMemos, type Memo } from '../composables/useMemos'
import { useTimerBridge } from '../composables/useTimerBridge'
import { eventTime, eventsNow, useEvents } from '../composables/useEvents'
import { useAiButler, selectUrgentTodos, type CoachFeedback } from '../composables/useAiButler'
import { useTodayPlan } from '../composables/useTodayPlan'
import { useInstructions } from '../composables/useInstructions'
import { useTronTodos, todoRemainingLabel } from '../composables/useTronTodos'
import { useTronMemo } from '../composables/useTronMemo'
import type { TronTodo } from '../utils/tronApi'
import { useWeeklyGoals } from '../composables/useWeeklyGoals'
import { useDailyStats } from '../composables/useDailyStats'
import { toLocalDateStr } from '../utils/date'
import { orderForDisplay, type PlanEntry } from '../utils/dayPlan'
import { ASSISTANT_NAME } from '../utils/assistant'

const emit = defineEmits<{ navigateEvents: [] }>()
const assistantName = ASSISTANT_NAME

const {
  memos,
  activeMemos,
  getDisplayTitle,
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

/** 未晚的开场白与生活提醒直接放在首页，不再单独占一个页面 */
const { coachInsight, dailySummary, configured, preference } = useAiButler()
const coachMessage = computed(() => coachInsight.value?.coach ?? null)

/** 当天安排带回来的开场白优先，后台自动刷新的旧建议作兜底 */
const planIsToday = computed(() => todayPlan.value?.date === dateOffset(0))
const coachGreeting = computed(() =>
  (planIsToday.value ? todayPlan.value?.greeting : null) ?? coachMessage.value?.greeting ?? '')
const coachCare = computed(() =>
  (planIsToday.value ? todayPlan.value?.care : null) ?? coachMessage.value?.care ?? '')

/** 今日安排：当天稳定的一份计划，做完勾掉，不随后台刷新漂移 */
const {
  plan: todayPlan,
  generating,
  closing: planClosing,
  ensureTodayPlan,
  regeneratePlan,
  toggleEntryDone,
  removeEntry,
} = useTodayPlan()

/** 指令入口：加日程、拆小记、调顺序先提案确认，闲聊走排程回应 */
const {
  proposal: planProposal,
  busy: instructionBusy,
  result: commandResult,
  submit: submitInstruction,
  confirm: confirmProposal,
  cancel: cancelProposal,
} = useInstructions()

onMounted(() => {
  void ensureTodayPlan()
})

// KeepAlive 缓存的页面重新激活时也补一次：跨日打开或上次生成失败能兜住
onActivated(() => {
  void ensureTodayPlan()
})

// 畅课待办：建议条目可以直接来自课程作业，无 Key 时本地提示也会用
const { sortedTodos: tronSortedTodos } = useTronTodos()

// 未晚的表情跟着本周完成的目标数走
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
  action: 'start' | 'events' | 'todo'
}

/** 最近的紧急课程作业：48 小时内截止或已过期（复用未晚上下文的挑选规则） */
const urgentTodo = computed(() => selectUrgentTodos(tronSortedTodos.value, Date.now(), 1)[0] ?? null)

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
  if (urgentTodo.value) {
    return {
      text: `「${urgentTodo.value.title}」${todoRemainingLabel(urgentTodo.value)}，先啃掉它吧，我陪你～`,
      actionLabel: '开始做',
      action: 'todo',
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
  if (localCoach.value.action === 'todo') {
    if (urgentTodo.value) startTodo(urgentTodo.value)
    return
  }
  const memo = recentMemos.value[0]
  if (memo) startMemo(memo)
}

/** 把课程待办落成小记再开始；转换与去重都在 useTronMemo 里，转过就直接开始那条小记 */
function startTodo(todo: TronTodo) {
  const { convert } = useTronMemo()
  const { memo } = convert(todo)
  start(memo.id, getDisplayTitle(memo))
}

/** 安排条目的实时标题：来源还在就显示实时标题，不在了退回生成时的快照 */
function entryTitle(entry: PlanEntry): string {
  if (entry.source === 'memo') {
    const memo = memos.value.find(item => item.id === entry.refId)
    if (memo) return getDisplayTitle(memo)
  } else {
    const todo = tronSortedTodos.value.find(item => item.id === entry.refId)
    if (todo) return todo.title
  }
  return entry.title
}

function entryCourse(entry: PlanEntry): string {
  if (entry.source === 'todo') {
    const todo = tronSortedTodos.value.find(item => item.id === entry.refId)
    if (todo) return todo.course
  }
  return entry.course ?? ''
}

/** 开始一条安排：课程待办先落成小记，小记直接开跑 */
function startEntry(entry: PlanEntry) {
  if (entry.source === 'todo') {
    const todo = tronSortedTodos.value.find(item => item.id === entry.refId)
    if (todo) startTodo(todo)
    return
  }
  const memo = memos.value.find(item => item.id === entry.refId && !item.completedAt)
  if (memo) start(memo.id, getDisplayTitle(memo))
}

/** 平铺展示：按建议先后排，做完的沉底 */
const planEntries = computed(() => orderForDisplay(todayPlan.value?.entries ?? []))

function dateOffset(offset: number): string {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return toLocalDateStr(date)
}

/** 总结优先展示；当天已有总结后又开始新一轮时，说明当时不是最后一轮，退回普通未晚 */
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

const planError = ref('')
const coachErrorExpanded = ref(false)
const coachNote = ref('')
// 「我有个想法」输入默认收起，点开才显示
const noteOpen = ref(false)

async function runPlan(feedback: CoachFeedback = {}) {
  if (generating.value) return
  planError.value = ''
  coachErrorExpanded.value = false
  try {
    await regeneratePlan(feedback)
  } catch (e) {
    planError.value = e instanceof Error ? e.message : String(e)
  }
}

function handlePreference(next: 'hard-first' | 'easy-first') {
  void runPlan({ preference: next })
}

async function sendInstruction() {
  const text = coachNote.value.trim()
  if (!text || generating.value || instructionBusy.value) return
  coachNote.value = ''
  const outcome = await submitInstruction(text)
  if (outcome === 'chat') await runPlan({ userNote: text })
}

function onCoachNoteEnter(event: KeyboardEvent) {
  // 中文输入法还在选词时，回车是确认候选，不是发送
  if (event.isComposing) return
  event.preventDefault()
  void sendInstruction()
}
</script>

<template>
  <div class="home-page">
    <section class="coach-card">
      <div class="coach-head">
        <span class="coach-title">{{ assistantName }}说<span v-if="mascotFace" class="coach-face">{{ mascotFace }}</span><span v-if="summaryToShow" class="coach-summary-tag">{{ summaryTagLabel }}</span></span>
        <div class="coach-head-actions">
          <button class="link-btn" @click="noteOpen = !noteOpen">
            {{ noteOpen ? '收起' : '我有个想法' }}
          </button>
        </div>
      </div>
      <template v-if="summaryToShow">
        <p class="coach-greeting">{{ summaryToShow.summary }}</p>
        <p v-if="summaryToShow.tomorrow" class="coach-care">{{ summaryToShow.tomorrow }}</p>
      </template>
      <template v-else-if="configured">
        <p v-if="coachGreeting" class="coach-greeting">{{ coachGreeting }}</p>
        <p v-else-if="coachInsight" class="coach-content">{{ coachInsight.content }}</p>
        <p v-else class="coach-empty">记点小记，未晚就能陪你排啦～</p>
        <p v-if="coachCare" class="coach-care">{{ coachCare }}</p>
      </template>
      <template v-else>
        <p class="coach-content">{{ localCoach.text }}</p>
        <div v-if="localCoach.actionLabel && !running" class="coach-local-action">
          <button class="coach-start-btn" @click="runLocalCoachAction">{{ localCoach.actionLabel }}</button>
        </div>
      </template>
      <div v-if="noteOpen" class="coach-interact">
        <div v-if="configured" class="coach-prefs">
          <button
            class="coach-pref-btn"
            :class="{ active: preference === 'hard-first' }"
            :disabled="generating"
            @click="handlePreference('hard-first')"
          >先啃难的</button>
          <button
            class="coach-pref-btn"
            :class="{ active: preference === 'easy-first' }"
            :disabled="generating"
            @click="handlePreference('easy-first')"
          >先做轻松的</button>
        </div>
        <div class="coach-note-row">
          <input
            v-model="coachNote"
            class="coach-note-input"
            type="text"
            placeholder="跟未晚说一句，比如「明天 3 点提醒我交作业」"
            :disabled="generating || instructionBusy"
            @keydown.enter="onCoachNoteEnter"
          />
          <button
            class="coach-send-btn"
            :disabled="generating || instructionBusy || !coachNote.trim()"
            @click="sendInstruction"
          >{{ instructionBusy ? '在想…' : '说' }}</button>
        </div>
        <div v-if="planProposal" class="coach-proposal">
          <p class="coach-proposal-text">{{ planProposal.summary }}</p>
          <div class="coach-proposal-actions">
            <button class="coach-pref-btn active" :disabled="instructionBusy" @click="confirmProposal()">就这么办</button>
            <button class="coach-pref-btn" @click="cancelProposal()">算了</button>
          </div>
        </div>
        <p v-if="commandResult" class="coach-result">{{ commandResult }}</p>
      </div>
      <p
        v-if="planError"
        class="coach-error"
        :class="{ expanded: coachErrorExpanded }"
        @click="coachErrorExpanded = !coachErrorExpanded"
      >{{ planError }}</p>
      <p v-if="planClosing && !summaryToShow" class="coach-care">{{ planClosing }}</p>
    </section>

    <section class="zone">
      <div class="zone-title">
        今日安排
        <button class="link-btn" :disabled="generating" @click="runPlan()">
          {{ generating ? '在排…' : '重新安排' }}
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

      <template v-else>
        <div
          v-for="entry in planEntries"
          :key="entry.id"
          class="suggestion-item plan-entry"
          :class="{ 'plan-done': entry.done }"
        >
          <button
            class="home-check-btn"
            :class="{ checked: entry.done }"
            :title="entry.done ? '还没做完，取消勾选' : '这条做完啦'"
            @click="toggleEntryDone(entry.id)"
          >
            <svg v-if="entry.done" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
              <polyline points="4 12 9 17 20 6"/>
            </svg>
          </button>
            <div class="suggestion-copy">
              <div class="suggestion-line">
                <span v-if="entryCourse(entry)" class="coach-plan-course">{{ entryCourse(entry) }}</span>
                <span class="suggestion-title">{{ entryTitle(entry) }}</span>
                <span class="suggestion-meta">
                  <span v-if="entry.when" class="suggestion-when">{{ entry.when }}</span>
                  {{ entry.donePomodoros > 0 ? `今天 ${entry.donePomodoros}/${entry.pomodoros}` : `${entry.pomodoros} 个番茄` }}
                </span>
              </div>
              <p v-if="entry.note" class="suggestion-reason">{{ entry.note }}</p>
            </div>
          <div class="suggestion-actions">
            <button v-if="!entry.done" class="coach-start-btn" :disabled="generating" @click="startEntry(entry)">开始</button>
            <button class="coach-swap-btn" :disabled="generating" title="这条今天先不算了" @click="removeEntry(entry.id)">✕</button>
          </div>
        </div>

        <div v-if="planEntries.length === 0 && !generating" class="empty">
          还没有要做的事，去小记页记一条吧～
        </div>
      </template>
    </section>
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

.coach-start-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.coach-interact {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 2px;
}

/* 指令提案：先过目再执行 */
.coach-proposal {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 9px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--focus-color) 10%, rgba(255, 255, 255, 0.03));
  border: 1px solid color-mix(in srgb, var(--focus-color) 30%, transparent);
}

.coach-proposal-text {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.85);
}

.coach-proposal-actions {
  display: flex;
  gap: 6px;
}

.coach-result {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: color-mix(in srgb, var(--focus-color) 80%, rgba(255, 255, 255, 0.4));
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

/* 今日安排：平铺按先后排，做完的沉底划掉 */
.plan-entry.plan-done {
  opacity: 0.5;
}

.plan-entry.plan-done .suggestion-title {
  text-decoration: line-through;
  color: rgba(255, 255, 255, 0.4);
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

.coach-plan-course {
  flex-shrink: 0;
  max-width: 72px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 9px;
  line-height: 1.4;
  color: color-mix(in srgb, var(--focus-color) 80%, transparent);
  background: color-mix(in srgb, var(--focus-color) 16%, transparent);
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

.home-check-btn.checked {
  border-color: color-mix(in srgb, var(--focus-color) 55%, transparent);
  background: color-mix(in srgb, var(--focus-color) 30%, transparent);
  color: var(--focus-color);
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
</style>
