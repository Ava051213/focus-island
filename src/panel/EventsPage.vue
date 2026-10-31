<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import {
  EVENT_TAGS,
  parseQuickEvent,
  useEvents,
  type CalendarEvent,
  type EventTag,
} from '../composables/useEvents'
import EventCard from './EventCard.vue'

const { upcoming, overdue, handledEvents, addEvent, updateEvent, deleteEvent, toggleHandled } = useEvents()

const draft = ref('')
const showHandled = ref(false)

const parseHint = computed(() => {
  const text = draft.value.trim()
  if (!text) return ''
  const parsed = parseQuickEvent(text)
  if (!parsed.title) return ''
  const tag = EVENT_TAGS.find(t => t.id === parsed.tag)?.label ?? ''
  const at = parsed.at.replace('T', ' ')
  return `${at} · ${tag}`
})

function submitDraft() {
  const text = draft.value.trim()
  if (!text) return
  const parsed = parseQuickEvent(text)
  if (!parsed.title) return
  addEvent(parsed)
  draft.value = ''
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
  updateEvent(editing.value.id, {
    title,
    at: form.time ? `${form.date}T${form.time}` : form.date,
    note: form.note.trim(),
    tag: form.tag,
  })
  editing.value = null
}

function removeEvent() {
  if (!editing.value) return
  deleteEvent(editing.value.id)
  editing.value = null
}
</script>

<template>
  <div class="events-page">
    <div class="quick-add" @click.stop>
      <input
        v-model="draft"
        class="quick-input"
        placeholder="明天 10:00 交季度报告 #工作"
        @keydown.enter="submitDraft"
      />
      <span v-if="parseHint" class="quick-hint">{{ parseHint }}</span>
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
