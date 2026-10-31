<script setup lang="ts">
import { computed } from 'vue'
import { useMemos, type Memo } from '../composables/useMemos'
import { useTimerBridge } from '../composables/useTimerBridge'
import { eventRelativeLabel, eventTime, useEvents } from '../composables/useEvents'

const emit = defineEmits<{ navigateEvents: [] }>()

const { memos, getDisplayTitle } = useMemos()
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

/** 最近更新的三条备忘，作为「现在可以动手」的候选 */
const recentMemos = computed(() =>
  memos.value
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 3),
)

const upcomingEvents = computed(() => withinDays(7).slice(0, 5))

function startMemo(memo: Memo) {
  start(memo.id, getDisplayTitle(memo))
}
</script>

<template>
  <div class="home-page">
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
          <span class="event-day">{{ eventRelativeLabel(event.at) }}</span>
          <span v-if="eventTime(event.at)" class="event-clock">{{ eventTime(event.at) }}</span>
          <span class="event-title">{{ event.title }}</span>
        </button>
      </div>

      <div v-else class="empty small">
        这七天干干净净的，正好留给想做的事呀～
      </div>
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
</style>
