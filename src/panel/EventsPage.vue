<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  EVENT_TAGS,
  parseQuickEvent,
  resolveEventAt,
  useEvents,
  type CalendarEvent,
  type EventTag,
} from '../composables/useEvents'
import { useAi } from '../composables/useAi'
import { refreshTronTodos, useTronTodos } from '../composables/useTronTodos'
import EventCard from './EventCard.vue'
import TronTodoCard from './TronTodoCard.vue'

const { upcoming, overdue, handledEvents, addEvent, updateEvent, deleteEvent, toggleHandled } = useEvents()
const { extractEvent, configured } = useAi()
const {
  sortedTodos: tronTodos,
  archivedTodos: tronArchived,
  markTodoDone,
  restoreTodoDone,
  loading: tronLoading,
  failure: tronFailure,
  stale: tronStale,
  lastSuccessLabel: tronUpdatedAt,
  now: tronNow,
} = useTronTodos()

const showTodoArchive = ref(false)

const draft = ref('')
const showHandled = ref(false)

/* 下拉刷新：只有列表已经在顶部、并且是往下拖时才接管，避免和正常滚动打架 */
const PULL_THRESHOLD = 46
const PULL_MAX = 64
const eventListRef = ref<HTMLElement | null>(null)
const pullOffset = ref(0)
const pulling = ref(false)
let pullStartX = 0
let pullStartY = 0
let pullPressing = false
let pullTracking = false

const pullLabel = computed(() => {
  if (tronLoading.value) return '正在刷新…'
  return pullOffset.value >= PULL_THRESHOLD ? '松手就刷新' : '再往下拉一点'
})

function resetPull() {
  pullPressing = false
  pullTracking = false
  pulling.value = false
  pullOffset.value = 0
}

function onListPointerDown(event: PointerEvent) {
  const list = eventListRef.value
  if (!list || list.scrollTop > 0) return
  if (event.pointerType === 'mouse' && event.button !== 0) return
  pullStartX = event.clientX
  pullStartY = event.clientY
  pullPressing = true
  pullTracking = false
}

function onListPointerMove(event: PointerEvent) {
  const list = eventListRef.value
  if (!list || !pullPressing) return
  const dy = event.clientY - pullStartY
  const dx = event.clientX - pullStartX
  if (list.scrollTop > 0 || dy <= 0) {
    if (pullTracking) resetPull()
    return
  }
  if (!pullTracking) {
    if (dy < 8 || Math.abs(dx) > dy) return
    pullTracking = true
    pulling.value = true
  }
  pullOffset.value = Math.min(PULL_MAX, dy * 0.55)
}

function onListPointerUp() {
  if (!pullPressing) return
  const shouldRefresh = pullTracking && pullOffset.value >= PULL_THRESHOLD
  resetPull()
  if (shouldRefresh) void refreshTronTodos({ force: true })
}

function onListPointerLeave() {
  if (pullPressing) resetPull()
}

/** 只用来决定提示文案：短句提示解析结果，长句提示会交给 AI 整理 */
const looksLikeSentence = computed(() => draft.value.trim().length > 20)

const parseHint = computed(() => {
  const text = draft.value.trim()
  if (!text) return ''
  const parsed = parseQuickEvent(text)
  if (!parsed.title) return ''
  const tag = EVENT_TAGS.find(t => t.id === parsed.tag)?.label ?? ''
  const at = parsed.at.replace('T', ' ')
  return `${at} · ${tag}`
})

interface EventDraft {
  title: string
  at: string
  note: string
  tag: EventTag
  source: 'ai' | 'local'
}

const aiLoading = ref(false)
const aiError = ref('')
const aiErrorExpanded = ref(false)
const preview = ref<EventDraft | null>(null)

function tagLabel(tag: EventTag): string {
  return EVENT_TAGS.find(t => t.id === tag)?.label ?? '其他'
}

/** 没有 Key 或 AI 失败时的退路：本地规则同样给出一张条子 */
function showLocalPreview() {
  const parsed = parseQuickEvent(draft.value)
  if (!parsed.title) return
  preview.value = {
    title: parsed.title,
    at: parsed.at,
    note: '',
    tag: parsed.tag,
    source: 'local',
  }
}

let requestSeq = 0

async function extractWithAi() {
  const text = draft.value.trim()
  if (!text || !configured.value) return
  const seq = ++requestSeq
  aiLoading.value = true
  aiError.value = ''
  aiErrorExpanded.value = false
  preview.value = null
  try {
    const result = await extractEvent(text)
    // 等待期间内容被改过或又发起了一次，丢弃这次结果
    if (seq !== requestSeq || draft.value.trim() !== text) return

    // 短句以本地换算为准，长段粘贴交给 AI；规则本身在 useEvents 里有单测
    const at = resolveEventAt(result.at, text)

    preview.value = {
      title: result.title,
      at,
      note: result.note,
      tag: (['work', 'life', 'study', 'other'].includes(result.tag) ? result.tag : 'other') as EventTag,
      source: 'ai',
    }
  } catch (e) {
    if (seq !== requestSeq) return
    aiError.value = e instanceof Error ? e.message : String(e)
    // 失败也别让用户白打一次字，给出本地条子
    showLocalPreview()
  } finally {
    if (seq === requestSeq) aiLoading.value = false
  }
}

/** 输入内容一变，之前整理出的条子就作废，避免拿旧结果显示新内容 */
watch(draft, () => {
  if (preview.value) preview.value = null
  aiError.value = ''
  aiErrorExpanded.value = false
})

function savePreview() {
  const item = preview.value
  if (!item) return
  addEvent({ title: item.title, at: item.at, note: item.note, tag: item.tag })
  preview.value = null
  draft.value = ''
  aiError.value = ''
}

function adjustPreview() {
  const item = preview.value
  if (!item) return
  const [date, time] = item.at.split('T')
  editing.value = {
    id: '',
    title: item.title,
    note: item.note,
    at: item.at,
    tag: item.tag,
    handled: false,
    createdAt: 0,
    updatedAt: 0,
  }
  form.title = item.title
  form.date = date ?? ''
  form.time = time ?? ''
  form.note = item.note
  form.tag = item.tag
  preview.value = null
  draft.value = ''
}

/** 回车只负责「整理成条子」，绝不在这一步建事件；建事件必须点保存 */
async function submitDraft() {
  const text = draft.value.trim()
  if (!text || aiLoading.value) return
  if (configured.value) {
    await extractWithAi()
  } else {
    showLocalPreview()
  }
}

const editing = ref<CalendarEvent | null>(null)
const form = reactive({
  title: '',
  date: '',
  time: '',
  note: '',
  tag: 'other' as EventTag,
})

function openEditor(event: CalendarEvent) {
  const [date, time] = event.at.split('T')
  editing.value = event
  form.title = event.title
  form.date = date ?? ''
  form.time = time ?? ''
  form.note = event.note
  form.tag = event.tag
}

function saveEditor() {
  if (!editing.value) return
  const title = form.title.trim()
  if (!title || !form.date) return
  const at = form.time ? `${form.date}T${form.time}` : form.date
  const note = form.note.trim()
  if (!editing.value.id) {
    // 从 AI 预览点「调整」过来的新事件
    addEvent({ title, at, note, tag: form.tag })
  } else {
    updateEvent(editing.value.id, { title, at, note, tag: form.tag })
  }
  editing.value = null
}

function removeEvent() {
  if (!editing.value) return
  if (editing.value.id) deleteEvent(editing.value.id)
  editing.value = null
}
</script>

<template>
  <div class="events-page">
    <div class="quick-add" @click.stop>
      <input
        v-model="draft"
        class="quick-input"
        placeholder="输入一件事，回车自动整理成日程"
        @keydown.enter="submitDraft"
      />

      <div v-if="aiLoading" class="ai-hint">未晚正在整理…</div>

      <div v-else-if="preview" class="ai-preview">
        <div class="preview-head">
          <span>确认这条</span>
          <span class="source-tag">{{ preview.source === 'ai' ? '未晚整理的' : '我自己理的' }}</span>
        </div>
        <div class="preview-title">{{ preview.title }}</div>
        <div class="preview-meta">
          {{ preview.at.replace('T', ' ') }} · {{ tagLabel(preview.tag) }}
        </div>
        <div v-if="preview.note" class="preview-note">{{ preview.note }}</div>
        <div
          v-if="aiError"
          class="preview-error"
          :class="{ expanded: aiErrorExpanded }"
          @click="aiErrorExpanded = !aiErrorExpanded"
        >{{ aiError }}</div>
        <div class="preview-actions">
          <button class="btn" @click="adjustPreview">调整</button>
          <button class="btn primary" @click="savePreview">保存</button>
        </div>
      </div>

      <span v-else-if="parseHint" class="quick-hint">
        {{ looksLikeSentence ? '回车就帮你整理好，大概是这样：' : '' }}{{ parseHint }}
      </span>
    </div>

    <div
      ref="eventListRef"
      class="event-list"
      :class="{ pulling }"
      @pointerdown="onListPointerDown"
      @pointermove="onListPointerMove"
      @pointerup="onListPointerUp"
      @pointercancel="resetPull"
      @pointerleave="onListPointerLeave"
    >
      <div class="pull-indicator" :style="{ height: `${pullOffset}px` }">
        <span v-if="pullOffset > 0" class="pull-text" :class="{ ready: pullOffset >= PULL_THRESHOLD }">
          {{ pullLabel }}
        </span>
      </div>

      <div class="tron-section">
        <div class="tron-head">
          <span class="tron-label">课程待办</span>
          <span class="tron-updated">
            <template v-if="tronLoading">刷新中…</template>
            <template v-else-if="tronUpdatedAt">
              {{ tronUpdatedAt }} 更新<template v-if="tronStale"> · 可能过期</template>
            </template>
            <template v-else>还没拉到</template>
          </span>
        </div>

        <div v-if="tronFailure" class="tron-error">
          {{ tronFailure.message }}
          <span v-if="tronStale" class="tron-error-note">下面保留的是上一次成功拉到的那份</span>
        </div>

        <div v-if="tronTodos.length === 0" class="tron-empty">
          <template v-if="tronLoading">正在拉取课程待办…</template>
          <template v-else-if="tronFailure">暂时没有可显示的待办</template>
          <template v-else>课程里没有待办，安心专注吧</template>
        </div>

        <TronTodoCard
          v-for="todo in tronTodos"
          :key="todo.id"
          :todo="todo"
          :now-ms="tronNow.getTime()"
          @toggle="markTodoDone(todo.id)"
        />

        <button
          v-if="tronArchived.length > 0"
          class="todo-archive-toggle"
          @click="showTodoArchive = !showTodoArchive"
        >
          {{ showTodoArchive ? '收起来' : '看看做过的' }}（{{ tronArchived.length }}）
        </button>

        <template v-if="showTodoArchive">
          <TronTodoCard
            v-for="todo in tronArchived"
            :key="todo.id"
            :todo="todo"
            :now-ms="tronNow.getTime()"
            done
            @toggle="restoreTodoDone(todo.id)"
          />
        </template>
      </div>

      <div v-if="upcoming.length === 0 && overdue.length === 0" class="empty-state">
        还没有日程，在上方输入即可添加
      </div>

      <template v-if="upcoming.length > 0">
        <div class="section-label">接下来的日程</div>
        <EventCard
          v-for="event in upcoming"
          :key="event.id"
          :event="event"
          @edit="openEditor(event)"
          @toggle="toggleHandled(event.id)"
        />
      </template>

      <template v-if="overdue.length > 0">
        <div class="section-label">已过期</div>
        <EventCard
          v-for="event in overdue"
          :key="event.id"
          :event="event"
          @edit="openEditor(event)"
          @toggle="toggleHandled(event.id)"
        />
      </template>

      <template v-if="handledEvents.length > 0">
        <button class="handled-toggle" @click="showHandled = !showHandled">
          {{ showHandled ? '收起来' : '看看处理过的' }}（{{ handledEvents.length }}）
        </button>
        <template v-if="showHandled">
          <EventCard
            v-for="event in handledEvents"
            :key="event.id"
            :event="event"
            @edit="openEditor(event)"
            @toggle="toggleHandled(event.id)"
          />
        </template>
      </template>
    </div>

    <teleport to=".panel-inner">
      <div v-if="editing" class="editor-mask" @click.self="editing = null">
        <div class="editor-card" @click.stop>
          <input v-model="form.title" class="editor-title" placeholder="要做的事" />

          <div class="editor-row">
            <input v-model="form.date" type="date" class="editor-input" />
            <input v-model="form.time" type="time" class="editor-input" />
          </div>

          <textarea v-model="form.note" class="editor-note" placeholder="补充两句（可选）" rows="3"></textarea>

          <div class="editor-tags">
            <button
              v-for="tag in EVENT_TAGS"
              :key="tag.id"
              class="tag-chip"
              :class="{ active: form.tag === tag.id }"
              :style="form.tag === tag.id ? { borderColor: tag.color, color: tag.color } : {}"
              @click="form.tag = tag.id"
            >
              {{ tag.label }}
            </button>
          </div>

          <div class="editor-actions">
            <button class="btn danger" @click="removeEvent">不要了</button>
            <div class="spacer"></div>
            <button class="btn" @click="editing = null">算了</button>
            <button class="btn primary" @click="saveEditor">记下来</button>
          </div>
        </div>
      </div>
    </teleport>
  </div>
</template>

<style scoped>
@reference "../styles.css";

.events-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.quick-add {
  padding: 10px 12px;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.quick-input {
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #fff;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  transition: all 0.2s;
}

.quick-input:focus {
  border-color: color-mix(in srgb, var(--focus-color) 50%, transparent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--focus-color) 12%, transparent);
}

.quick-input::placeholder {
  color: rgba(255, 255, 255, 0.25);
}

.quick-hint {
  display: block;
  margin-top: 5px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.35);
}

.link-btn {
  background: none;
  border: none;
  padding: 0;
  color: var(--focus-color);
  font-size: inherit;
  font-family: inherit;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.ai-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 5px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
}

.ai-hint.error {
  color: #f87171;
}

.ai-preview {
  margin-top: 8px;
  padding: 9px 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--focus-color) 8%, rgba(255, 255, 255, 0.03));
  border: 1px solid color-mix(in srgb, var(--focus-color) 25%, transparent);
}

.preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 9px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.3);
  margin-bottom: 4px;
}

.source-tag {
  letter-spacing: 0;
  text-transform: none;
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.35);
}

.preview-error {
  margin-top: 6px;
  font-size: 10px;
  color: #f87171;
  cursor: pointer;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.preview-error.expanded {
  display: block;
  -webkit-line-clamp: unset;
}

.preview-title {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.92);
}

.preview-meta {
  margin-top: 2px;
  font-size: 11px;
  color: color-mix(in srgb, var(--focus-color) 85%, transparent);
}

.preview-note {
  margin-top: 5px;
  font-size: 11px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.45);
  max-height: 54px;
  overflow: hidden;
}

.preview-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 8px;
}

.event-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.event-list.pulling {
  user-select: none;
}

.pull-indicator {
  flex-shrink: 0;
  height: 0;
  margin-bottom: -5px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  transition: height 0.16s ease;
}

.pull-text {
  font-size: 10px;
  letter-spacing: 0.06em;
  color: rgba(255, 255, 255, 0.35);
}

.pull-text.ready {
  color: var(--focus-color);
}

.tron-section {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.tron-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 2px 3px;
}

.tron-label {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  color: rgba(255, 255, 255, 0.28);
}

.tron-updated {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.3);
}

.tron-error {
  padding: 7px 9px;
  border-radius: 7px;
  font-size: 10px;
  line-height: 1.55;
  color: #f87171;
  background: rgba(248, 113, 113, 0.1);
  border: 1px solid rgba(248, 113, 113, 0.22);
}

.tron-error-note {
  display: block;
  margin-top: 2px;
  color: rgba(248, 113, 113, 0.65);
}

.tron-empty {
  padding: 18px 8px;
  text-align: center;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.3);
}

.todo-archive-toggle {
  margin-top: 2px;
  padding: 4px 2px;
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.35);
  font-size: 10px;
  font-family: inherit;
  cursor: pointer;
  text-align: left;
}

.todo-archive-toggle:hover {
  color: rgba(255, 255, 255, 0.6);
}

.section-label {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.28);
  padding: 10px 2px 4px;
}

.empty-state {
  padding: 40px 16px;
  text-align: center;
  font-size: 12px;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.3);
}

.handled-toggle {
  margin-top: 10px;
  padding: 6px 2px;
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.35);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  text-align: left;
}

.handled-toggle:hover {
  color: rgba(255, 255, 255, 0.6);
}

.editor-mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1200;
  padding: 20px;
}

.editor-card {
  width: 100%;
  max-width: 340px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  border-radius: 12px;
  background: rgba(28, 28, 32, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
}

.editor-title {
  padding: 8px 10px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #fff;
  font-size: 13px;
  font-family: inherit;
  outline: none;
}

.editor-row {
  display: flex;
  gap: 8px;
}

.editor-input {
  flex: 1;
  min-width: 0;
  padding: 7px 9px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.85);
  font-size: 12px;
  font-family: inherit;
  outline: none;
  color-scheme: dark;
}

.editor-note {
  padding: 8px 10px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.85);
  font-size: 12px;
  font-family: inherit;
  outline: none;
  resize: vertical;
}

.editor-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.tag-chip {
  padding: 3px 9px;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.45);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
}

.tag-chip:hover {
  color: rgba(255, 255, 255, 0.8);
}

.editor-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}

.spacer {
  flex: 1;
}

.btn {
  padding: 5px 12px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.6);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
}

.btn:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.12);
}

.btn.primary {
  color: var(--focus-color);
  border-color: color-mix(in srgb, var(--focus-color) 40%, transparent);
  background: color-mix(in srgb, var(--focus-color) 15%, transparent);
}

.btn.danger {
  color: #f87171;
  border-color: rgba(248, 113, 113, 0.25);
}
</style>
