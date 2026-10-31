<script setup lang="ts">
import { computed } from 'vue'
import {
  EVENT_TAGS,
  eventRelativeLabel,
  eventTime,
  type CalendarEvent,
} from '../composables/useEvents'

const props = defineProps<{
  event: CalendarEvent
}>()

const emit = defineEmits<{
  edit: []
  toggle: []
}>()

const dayLabel = computed(() => eventRelativeLabel(props.event.at))
const clock = computed(() => eventTime(props.event.at))
const tag = computed(() => EVENT_TAGS.find(t => t.id === props.event.tag) ?? EVENT_TAGS[3])
</script>

<template>
  <div
    class="event-row"
    :class="{ 'is-handled': event.handled }"
    @click="emit('edit')"
  >
    <span class="event-when">
      <span class="event-day">{{ dayLabel }}</span>
      <span v-if="clock" class="event-clock">{{ clock }}</span>
    </span>

    <span class="event-title">{{ event.title }}</span>

    <span v-if="event.note" class="event-note" :title="event.note">{{ event.note }}</span>

    <span class="event-tag" :style="{ color: tag.color, borderColor: tag.color }">{{ tag.label }}</span>

    <button
      class="event-check"
      :class="{ checked: event.handled }"
      @click.stop="emit('toggle')"
      :title="event.handled ? '还没做完' : '做完啦'"
    >
      <svg v-if="event.handled" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>
    </button>
  </div>
</template>

<style scoped>
@reference "../styles.css";

.event-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.06);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.event-row:hover {
  background: rgba(255, 255, 255, 0.07);
  border-color: rgba(255, 255, 255, 0.12);
}

.event-row.is-handled {
  opacity: 0.45;
}

.event-when {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex-shrink: 0;
  width: 46px;
}

.event-day {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.55);
  line-height: 1.1;
}

.event-clock {
  font-size: 10px;
  color: color-mix(in srgb, var(--focus-color) 85%, transparent);
  font-variant-numeric: tabular-nums;
}

.event-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.9);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.is-handled .event-title {
  text-decoration: line-through;
}

.event-note {
  max-width: 30%;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.event-tag {
  flex-shrink: 0;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid transparent;
  opacity: 0.85;
}

.event-check {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1.5px solid rgba(255, 255, 255, 0.25);
  background: transparent;
  color: rgba(255, 255, 255, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s;
  padding: 0;
}

.event-check:hover {
  border-color: var(--focus-color);
  color: var(--focus-color);
}

.event-check.checked {
  border-color: color-mix(in srgb, var(--focus-color) 70%, transparent);
  background: color-mix(in srgb, var(--focus-color) 25%, transparent);
  color: var(--focus-color);
}
</style>
