<script setup lang="ts">
import { computed } from 'vue'
import {
  todoDueLabel,
  todoIsDueToday,
  todoIsOverdue,
  todoRemainingLabel,
} from '../composables/useTronTodos'
import type { TronTodo } from '../utils/tronApi'

const props = defineProps<{
  todo: TronTodo
  nowMs: number
}>()

const overdue = computed(() => todoIsOverdue(props.todo, props.nowMs))
const dueToday = computed(() => !overdue.value && todoIsDueToday(props.todo, props.nowMs))
const remaining = computed(() => todoRemainingLabel(props.todo, props.nowMs))
const dueLabel = computed(() => todoDueLabel(props.todo))
</script>

<template>
  <div class="todo-card" :class="{ overdue, today: dueToday }">
    <div class="todo-text">
      <div class="todo-title">{{ todo.title }}</div>
      <div class="todo-course">{{ todo.course || '未标注课程' }}</div>
    </div>
    <div class="todo-meta">
      <div class="todo-remaining">{{ remaining }}</div>
      <div v-if="dueLabel" class="todo-due">{{ dueLabel }}</div>
    </div>
  </div>
</template>

<style scoped>
@reference "../styles.css";

.todo-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-left: 2px solid color-mix(in srgb, var(--focus-color) 45%, transparent);
}

.todo-card.today {
  border-left-color: #f87171;
  background: color-mix(in srgb, #f87171 7%, rgba(255, 255, 255, 0.03));
}

.todo-card.overdue {
  opacity: 0.5;
  border-left-color: rgba(255, 255, 255, 0.2);
}

.todo-text {
  min-width: 0;
  flex: 1;
}

.todo-title {
  font-size: 12px;
  line-height: 1.45;
  color: rgba(255, 255, 255, 0.9);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.todo-course {
  margin-top: 2px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.todo-meta {
  flex-shrink: 0;
  text-align: right;
}

.todo-remaining {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: color-mix(in srgb, var(--focus-color) 85%, transparent);
}

.todo-card.today .todo-remaining {
  color: #f87171;
}

.todo-card.overdue .todo-remaining {
  color: rgba(255, 255, 255, 0.55);
}

.todo-due {
  margin-top: 2px;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.35);
}

.todo-card.today .todo-due {
  color: color-mix(in srgb, #f87171 80%, transparent);
}
</style>
