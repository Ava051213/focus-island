<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import {
  EVENT_TAGS,
  parseQuickEvent,
  useEvents,
  type CalendarEvent,
  type EventTag,
} from '../composables/useEvents'
import { useAi } from '../composables/useAi'
import EventCard from './EventCard.vue'

const { upcoming, overdue, handledEvents, addEvent, updateEvent, deleteEvent, toggleHandled } = useEvents()
const { extractEvent, configured } = useAi()

const draft = ref('')
const showHandled = ref(false)

/** 超过这个字数就认为不是「一句话」，考虑交给 AI 提炼 */
const LONG_TEXT_THRESHOLD = 30

const isLongDraft = computed(() => draft.value.trim().length > LONG_TEXT_THRESHOLD)

const parseHint = computed(() => {
  const text = draft.value.trim()
  if (!text) return ''
  const parsed = parseQuickEvent(text)
  if (!parsed.title) return ''
  const tag = EVENT_TAGS.find(t => t.id === parsed.tag)?.label ?? ''
  const at = parsed.at.replace('T', ' ')
  return `${at} · ${tag}`
})

const aiLoading = ref(false)
const aiError = ref('')
const aiPreview = ref<{ title: string; at: string; note: string; tag: EventTag } | null>(null)

function tagLabel(tag: EventTag): string {
  return EVENT_TAGS.find(t => t.id === tag)?.label ?? '其他'
}

async function extractWithAi() {
  const text = draft.value.trim()
  if (!text || !configured.value || aiLoading.value) return
  aiLoading.value = true
  aiError.value = ''
  aiPreview.value = null
  try {
    const result = await extractEvent(text)
    aiPreview.value = {
      title: result.title,
      at: result.at,
      note: result.note,
      tag: (['work', 'life', 'study', 'other'].includes(result.tag) ? result.tag : 'other') as EventTag,
    }
  } catch (e) {
    aiError.value = e instanceof Error ? e.message : String(e)
  } finally {
    aiLoading.value = false
  }
}

/** 粘贴后等一拍再判断长度，此时 draft 已经更新 */
function onPasteDraft() {
  setTimeout(() => {
    if (isLongDraft.value && configured.value) void extractWithAi()
  }, 60)
}

function saveAiPreview() {
  const preview = aiPreview.value
  if (!preview) return
  addEvent({ title: preview.title, at: preview.at, note: preview.note, tag: preview.tag })
  aiPreview.value = null
  draft.value = ''
}

function adjustAiPreview() {
  const preview = aiPreview.value
  if (!preview) return
  const [date, time] = preview.at.split('T')
  editing.value = {
    id: '',
    title: preview.title,
    note: preview.note,
    at: preview.at,
    tag: preview.tag,
    handled: false,
    createdAt: 0,
    updatedAt: 0,
  }
  form.title = preview.title
  form.date = date ?? ''
  form.time = time ?? ''
  form.note = preview.note
  form.tag = preview.tag
  aiPreview.value = null
  draft.value = ''
}

function submitDraft() {
  const text = draft.value.trim()
  if (!text) return
  if (aiPreview.value) {
    saveAiPreview()
    return
  }
  const parsed = parseQuickEvent(text)
  if (!parsed.title) return
  addEvent(parsed)
  draft.value = ''
  aiError.value = ''
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
        placeholder="明天 10:00 交季度报告 #工作，或直接粘贴一整段"
        @keydown.enter="submitDraft"
        @paste="onPasteDraft"
      />

      <div v-if="aiLoading" class="ai-hint">正在整理这段…</div>

      <div v-else-if="aiError" class="ai-hint error">
        <span>{{ aiError }}</span>
        <button class="link-btn" @click="extractWithAi">重试</button>
      </div>

      <div v-else-if="aiPreview" class="ai-preview">
        <div class="preview-head">将创建这条日程</div>
        <div class="preview-title">{{ aiPreview.title }}</div>
        <div class="preview-meta">
          {{ aiPreview.at.replace('T', ' ') }} · {{ tagLabel(aiPreview.tag) }}
        </div>
        <div v-if="aiPreview.note" class="preview-note">{{ aiPreview.note }}</div>
        <div class="preview-actions">
          <button class="btn" @click="adjustAiPreview">调整</button>
          <button class="btn primary" @click="saveAiPreview">保存</button>
        </div>
      </div>

      <template v-else>
        <span v-if="!isLongDraft && parseHint" class="quick-hint">{{ parseHint }}</span>
        <span v-else-if="isLongDraft && configured" class="quick-hint">
          这段有点长，<button class="link-btn" @click="extractWithAi">用 AI 提炼成日程</button>
        </span>
        <span v-else-if="isLongDraft" class="quick-hint">
          这段会被整段当成事件名。在「设置 → AI 助手」填 Key 后可以自动提炼。
        </span>
      </template>
    </div>

    <div class="event-list">
      <div v-if="upcoming.length === 0 && overdue.length === 0" class="empty-state">
        还没有排期的事。想记一件未来会发生的事，直接在上面打一行。
      </div>

      <template v-if="upcoming.length > 0">
        <div class="section-label">接下来</div>
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
          {{ showHandled ? '收起' : '查看' }}已处理（{{ handledEvents.length }}）
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
          <input v-model="form.title" class="editor-title" placeholder="事件名称" />

          <div class="editor-row">
            <input v-model="form.date" type="date" class="editor-input" />
            <input v-model="form.time" type="time" class="editor-input" />
          </div>

          <textarea v-model="form.note" class="editor-note" placeholder="描述（可选）" rows="3"></textarea>

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
            <button class="btn danger" @click="removeEvent">删除</button>
            <div class="spacer"></div>
            <button class="btn" @click="editing = null">取消</button>
            <button class="btn primary" @click="saveEditor">保存</button>
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
  font-size: 9px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.3);
  margin-bottom: 4px;
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
